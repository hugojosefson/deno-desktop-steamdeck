import { Buffer } from "buffer";
import { readVdf, writeVdf } from "steam-binary-vdf";
import polycrc from "polycrc";
import { log } from "./lib/log.ts";

const APP_NAME = "Hello Steam Deck";

function isLinux(): boolean {
  const result = Deno.build.os === "linux";
  console.error(`[steam-deck] isLinux: ${result} (os=${Deno.build.os})`);
  return result;
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    console.error(`[steam-deck] commandExists: checking "${cmd}"`);
    const p = new Deno.Command(cmd, { args: ["--version"] }).spawn();
    const status = await p.status;
    const result = status.code === 0;
    console.error(
      `[steam-deck] commandExists: "${cmd}" => ${result} (exit code ${status.code})`,
    );
    return result;
  } catch (e) {
    console.error(
      `[steam-deck] commandExists: "${cmd}" => false (exception: ${e})`,
    );
    return false;
  }
}

async function isSteamOS(): Promise<boolean> {
  const linux = isLinux();
  const exists = linux ? await commandExists("steamosctl") : false;
  console.error(
    `[steam-deck] isSteamOS: linux=${linux} steamosctl=${exists} => ${
      linux && exists
    }`,
  );
  return linux && exists;
}

function isInGameMode(): boolean {
  const xdg = Deno.env.get("XDG_CURRENT_DESKTOP");
  const steamAppId = Deno.env.get("SteamAppId");
  const steamGameId = Deno.env.get("SteamGameId");
  const gamescopeVer = Deno.env.get("GAMESCOPE_VERSION");
  console.error(
    `[steam-deck] isInGameMode: XDG_CURRENT_DESKTOP=${xdg} SteamAppId=${steamAppId} SteamGameId=${steamGameId} GAMESCOPE_VERSION=${gamescopeVer}`,
  );
  if (xdg === "gamescope") {
    console.error(
      `[steam-deck] isInGameMode: true (XDG_CURRENT_DESKTOP === gamescope)`,
    );
    return true;
  }
  if (steamAppId || steamGameId) {
    console.error(
      `[steam-deck] isInGameMode: true (SteamAppId/SteamGameId set)`,
    );
    return true;
  }
  if (gamescopeVer) {
    console.error(`[steam-deck] isInGameMode: true (GAMESCOPE_VERSION set)`);
    return true;
  }
  console.error(`[steam-deck] isInGameMode: false`);
  return false;
}

function isLaunchedBySteam(): boolean {
  const steamAppId = Deno.env.get("SteamAppId");
  const steamGameId = Deno.env.get("SteamGameId");
  const steamRuntime = Deno.env.get("STEAM_RUNTIME");
  const result = !!(steamAppId || steamGameId || steamRuntime);
  console.error(
    `[steam-deck] isLaunchedBySteam: SteamAppId=${steamAppId} SteamGameId=${steamGameId} STEAM_RUNTIME=${steamRuntime} => ${result}`,
  );
  return result;
}

function findSteamDir(): string | null {
  const home = Deno.env.get("HOME");
  console.error(`[steam-deck] findSteamDir: HOME=${home}`);
  if (!home) {
    console.error(`[steam-deck] findSteamDir: null (no HOME)`);
    return null;
  }

  const candidates = [
    `${home}/.local/share/Steam`,
    `/usr/lib/steam`,
    `/home/.local/share/Steam`,
  ];

  for (const dir of candidates) {
    try {
      const info = Deno.statSync(dir);
      console.error(
        `[steam-deck] findSteamDir: checking ${dir} => isDirectory=${info.isDirectory}`,
      );
      if (info.isDirectory) {
        console.error(`[steam-deck] findSteamDir: found ${dir}`);
        return dir;
      }
    } catch (e) {
      console.error(`[steam-deck] findSteamDir: checking ${dir} => error ${e}`);
    }
  }

  console.error(`[steam-deck] findSteamDir: null (no candidates matched)`);
  return null;
}

function findSteamUserId(steamDir: string): string | null {
  const userdataDir = `${steamDir}/userdata`;
  console.error(`[steam-deck] findSteamUserId: scanning ${userdataDir}`);
  try {
    for (const entry of Deno.readDirSync(userdataDir)) {
      const isMatch = entry.isDirectory && /^\d+$/.test(entry.name);
      console.error(
        `[steam-deck] findSteamUserId: entry=${entry.name} isDir=${entry.isDirectory} match=${isMatch}`,
      );
      if (isMatch) {
        console.error(`[steam-deck] findSteamUserId: found ${entry.name}`);
        return entry.name;
      }
    }
  } catch (e) {
    console.error(`[steam-deck] findSteamUserId: error ${e}`);
  }
  console.error(`[steam-deck] findSteamUserId: null`);
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

function findShortcutByKey(
  shortcuts: Record<string, unknown>,
  exe: string,
): [string, Record<string, unknown>] | null {
  for (const [key, entry] of Object.entries(shortcuts)) {
    if (typeof entry === "object" && entry !== null) {
      const s = entry as Record<string, unknown>;
      if (s.exe === exe) return [key, s];
    }
  }
  return null;
}

function shortcutNeedsUpdate(
  shortcut: Record<string, unknown>,
  appName: string,
  exe: string,
  icon: string | null,
  startDir: string,
): boolean {
  return (
    shortcut.AppName !== appName ||
    shortcut.exe !== `"${exe}"` ||
    shortcut.icon !== (icon ? `"${icon}"` : "") ||
    shortcut.StartDir !== `"${startDir}"`
  );
}

function computeAppId(appName: string): number {
  const hash = polycrc.crc32(appName);
  return (hash >>> 0) | 0x80000000;
}

async function addSteamShortcut(
  appName: string,
  exePath: string,
  iconPath: string | null,
  startDir: string,
): Promise<string | null> {
  await log("info", "addSteamShortcut: start", {
    appName,
    exePath,
    iconPath,
    startDir,
  });
  const steamDir = findSteamDir();
  await log("info", "addSteamShortcut: steamDir", { steamDir });
  if (!steamDir) {
    await log("info", "addSteamShortcut: null (no steam dir)");
    return null;
  }

  const userId = findSteamUserId(steamDir);
  await log("info", "addSteamShortcut: userId", { userId });
  if (!userId) {
    await log("info", "addSteamShortcut: null (no userId)");
    return null;
  }

  const vdfPath = getShortcutsVdfPath(steamDir, userId);
  const configDir = `${steamDir}/userdata/${userId}/config`;
  await log("info", "addSteamShortcut: paths", { vdfPath, configDir });

  let data: Record<string, unknown>;
  let shortcutKey: string | null = null;

  try {
    const raw = await Deno.readFile(vdfPath);
    const buf = Buffer.from(raw);
    // @ts-ignore Buffer type compatibility with npm package
    data = readVdf(buf) as Record<string, unknown>;
    await log("info", "addSteamShortcut: read existing vdf", {
      keys: Object.keys(data),
    });
  } catch (e) {
    await log("info", "addSteamShortcut: no existing vdf, starting fresh", {
      error: String(e),
    });
    data = { shortcuts: {} };
  }

  const shortcuts = (data.shortcuts ??= {}) as Record<string, unknown>;
  await log("info", "addSteamShortcut: shortcuts count", {
    count: Object.keys(shortcuts).length,
  });

  const existing = findShortcutByKey(shortcuts, `"${exePath}"`);
  await log("info", "addSteamShortcut: existing shortcut", {
    found: existing !== null,
  });
  if (existing !== null) {
    const [key, shortcut] = existing;
    const needsUpdate = shortcutNeedsUpdate(
      shortcut,
      appName,
      exePath,
      iconPath,
      startDir,
    );
    await log("info", "addSteamShortcut: shortcutNeedsUpdate", {
      key,
      needsUpdate,
      currentAppName: shortcut.AppName,
      currentExe: shortcut.exe,
      currentIcon: shortcut.icon,
      currentStartDir: shortcut.StartDir,
    });
    if (!needsUpdate) {
      await log("info", "addSteamShortcut: shortcut up to date");
      shortcutKey = key;
      return key;
    }
    shortcuts[key] = {
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
      LastPlayTime: shortcut.LastPlayTime ?? 0,
      tags: {},
    };
    await log("info", "addSteamShortcut: updated existing shortcut", { key });
    shortcutKey = key;
  } else {
    const idx = getNextShortcutIndex(shortcuts);
    await log("info", "addSteamShortcut: creating new shortcut", { idx });
    shortcutKey = idx;
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
  }

  try {
    await Deno.mkdir(configDir, { recursive: true });
    await log("info", "addSteamShortcut: ensured config dir");
  } catch (e) {
    await log("info", "addSteamShortcut: mkdir error (non-fatal)", {
      error: String(e),
    });
  }

  // @ts-ignore VdfMap type compatibility
  const outBuf = writeVdf(data);
  await Deno.writeFile(vdfPath, outBuf);
  await log("info", "addSteamShortcut: wrote vdf, returning key");
  return shortcutKey;
}

async function switchToGameMode(
  appId: number,
): Promise<{ switched: boolean; appId: number }> {
  await log("info", "switchToGameMode: launching steam in game mode", {
    appId,
  });
  try {
    const steam = new Deno.Command("steam", {
      args: ["-steamos3", "-gamepadui"],
      stdout: "null",
      stderr: "null",
    }).spawn();

    // Wait until steam starts listening (port 27036/27037 = gamepadui)
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const tcp = Deno.readTextFileSync("/proc/net/tcp");
        if (tcp.includes("000069A8") || tcp.includes("000069A9")) {
          ready = true;
          break;
        }
      } catch {
        // /proc/net/tcp may not be available
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    await log("info", "switchToGameMode: steam ready check", {
      ready,
      waitedMs: 30_000 - (deadline - Date.now()),
    });

    await log("info", "switchToGameMode: triggering app launch", { appId });
    const launch = new Deno.Command("steam", {
      args: [`steam://rungameid/${appId}`],
      stdout: "null",
      stderr: "null",
    }).spawn();
    const launchStatus = await launch.status;
    await log("info", "switchToGameMode: launch result", {
      exitCode: launchStatus.code,
      success: launchStatus.code === 0,
    });

    // Detach — don't wait for steam process, let it keep running
    steam.unref();

    return { switched: true, appId };
  } catch (e) {
    await log("error", "switchToGameMode: exception", { error: String(e) });
    return { switched: false, appId };
  }
}

interface SteamDeckResult {
  added: boolean;
  switched: boolean;
  switchFailed: boolean;
  needsRelaunch: boolean;
}

export async function ensureSteamDeckIntegration(
  exePath: string,
  iconPath: string | null,
): Promise<SteamDeckResult> {
  await log("info", "ensureSteamDeckIntegration: start", { exePath, iconPath });

  const steamOs = await isSteamOS();
  await log("info", "ensureSteamDeckIntegration: isSteamOS", {
    result: steamOs,
  });
  if (!steamOs) {
    await log("info", "ensureSteamDeckIntegration: not SteamOS, skipping");
    return {
      added: false,
      switched: false,
      switchFailed: false,
      needsRelaunch: false,
    };
  }

  const appDir = exePath.substring(0, exePath.lastIndexOf("/"));
  await log("info", "ensureSteamDeckIntegration: appDir", { appDir });
  const shortcutKey = await addSteamShortcut(
    APP_NAME,
    exePath,
    iconPath,
    appDir,
  );
  await log("info", "ensureSteamDeckIntegration: addSteamShortcut result", {
    shortcutKey,
  });

  if (shortcutKey === null) {
    await log(
      "info",
      "ensureSteamDeckIntegration: shortcut not added, stopping",
    );
    return {
      added: false,
      switched: false,
      switchFailed: false,
      needsRelaunch: false,
    };
  }

  const appId = computeAppId(APP_NAME);
  await log("info", "ensureSteamDeckIntegration: appId computed", { appId });

  const gameMode = isInGameMode();
  const launchedBySteam = isLaunchedBySteam();
  await log("info", "ensureSteamDeckIntegration: mode check", {
    gameMode,
    launchedBySteam,
  });

  if (gameMode || launchedBySteam) {
    await log(
      "info",
      "ensureSteamDeckIntegration: already in game mode or launched by steam, no switch needed",
    );
    return {
      added: true,
      switched: false,
      switchFailed: false,
      needsRelaunch: false,
    };
  }

  const switchResult = await switchToGameMode(appId);
  await log("info", "ensureSteamDeckIntegration: switchToGameMode result", {
    switched: switchResult.switched,
  });
  return {
    added: true,
    switched: switchResult.switched,
    switchFailed: !switchResult.switched,
    needsRelaunch: switchResult.switched,
  };
}

export { isInGameMode, isLaunchedBySteam, isSteamOS };
