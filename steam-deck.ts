import { Buffer } from "buffer";
import { readVdf, writeVdf } from "steam-binary-vdf";

const APP_NAME = "Hello Steam Deck";

function isLinux(): boolean {
  return Deno.build.os === "linux";
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const p = new Deno.Command(cmd, { args: ["--version"] }).spawn();
    const status = await p.status;
    return status.code === 0;
  } catch {
    return false;
  }
}

async function isSteamOS(): Promise<boolean> {
  return isLinux() && (await commandExists("steamosctl"));
}

function isInGameMode(): boolean {
  return Deno.env.get("XDG_CURRENT_DESKTOP") === "gamescope";
}

function findSteamDir(): string | null {
  const home = Deno.env.get("HOME");
  if (!home) return null;

  const candidates = [
    `${home}/.local/share/Steam`,
    `/usr/lib/steam`,
    `/home/.local/share/Steam`,
  ];

  for (const dir of candidates) {
    try {
      const info = Deno.statSync(dir);
      if (info.isDirectory) return dir;
    } catch {
      // continue
    }
  }

  return null;
}

function findSteamUserId(steamDir: string): string | null {
  const userdataDir = `${steamDir}/userdata`;
  try {
    for (const entry of Deno.readDirSync(userdataDir)) {
      if (entry.isDirectory && /^\d+$/.test(entry.name)) {
        return entry.name;
      }
    }
  } catch {
    // continue
  }
  return null;
}

function getShortcutsVdfPath(steamDir: string, userId: string): string {
  return `${steamDir}/userdata/${userId}/config/shortcuts.vdf`;
}

function getNextShortcutIndex(shortcuts: Record<string, unknown>): string {
  const keys = Object.keys(shortcuts).filter((k) => /^\d+$/.test(k));
  const maxIdx = keys.length > 0 ? Math.max(...keys.map(Number)) : -1;
  return String(maxIdx + 1);
}

function shortcutAlreadyExists(
  shortcuts: Record<string, unknown>,
  exe: string,
): boolean {
  for (const entry of Object.values(shortcuts)) {
    if (typeof entry === "object" && entry !== null) {
      const s = entry as Record<string, unknown>;
      if (s.exe === exe) return true;
    }
  }
  return false;
}

async function addSteamShortcut(
  appName: string,
  exePath: string,
  iconPath: string | null,
  startDir: string,
): Promise<boolean> {
  const steamDir = findSteamDir();
  if (!steamDir) return false;

  const userId = findSteamUserId(steamDir);
  if (!userId) return false;

  const vdfPath = getShortcutsVdfPath(steamDir, userId);
  const configDir = `${steamDir}/userdata/${userId}/config`;

  let data: Record<string, unknown>;

  try {
    const raw = await Deno.readFile(vdfPath);
    const buf = Buffer.from(raw);
    // @ts-ignore Buffer type compatibility with npm package
    data = readVdf(buf) as Record<string, unknown>;
  } catch {
    data = { shortcuts: {} };
  }

  const shortcuts = (data.shortcuts ??= {}) as Record<string, unknown>;

  if (shortcutAlreadyExists(shortcuts, exePath)) {
    return true;
  }

  const idx = getNextShortcutIndex(shortcuts);
  shortcuts[idx] = {
    AppName: appName,
    exe: `"${exePath}"`,
    StartDir: `"${startDir}"`,
    icon: iconPath ? `"${iconPath}"` : "",
    ShortcutPath: "",
    LaunchOptions: "",
    IsHidden: 0,
    AllowDesktopConfig: 1,
    AllowOverlay: 1,
    openvr: 0,
    Devkit: 0,
    DevkitGameID: "",
    LastPlayTime: 0,
    tags: {},
  };

  try {
    await Deno.mkdir(configDir, { recursive: true });
  } catch {
    // continue
  }

  // @ts-ignore VdfMap type compatibility
  const outBuf = writeVdf(data);
  await Deno.writeFile(vdfPath, outBuf);
  return true;
}

async function switchToGameMode(): Promise<boolean> {
  try {
    const p = new Deno.Command("steamosctl", {
      args: ["switch-to-game-mode"],
    }).spawn();
    const status = await p.status;
    return status.code === 0;
  } catch {
    return false;
  }
}

interface SteamDeckResult {
  added: boolean;
  switched: boolean;
  needsRelaunch: boolean;
}

export async function ensureSteamDeckIntegration(
  exePath: string,
  iconPath: string | null,
): Promise<SteamDeckResult> {
  if (!(await isSteamOS())) {
    return { added: false, switched: false, needsRelaunch: false };
  }

  if (isInGameMode()) {
    return { added: false, switched: false, needsRelaunch: false };
  }

  const appDir = exePath.substring(0, exePath.lastIndexOf("/"));
  const added = await addSteamShortcut(
    APP_NAME,
    exePath,
    iconPath,
    appDir,
  );

  if (!added) {
    return { added: false, switched: false, needsRelaunch: false };
  }

  const switched = await switchToGameMode();
  return {
    added,
    switched,
    needsRelaunch: switched,
  };
}

export { isInGameMode, isSteamOS };
