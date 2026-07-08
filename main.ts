import {
  computeAppId,
  ensureSteamDeckIntegration,
  isInGameMode,
  isLaunchedBySteam,
  switchToGameMode,
} from "./steam-deck.ts";
import { log, logError, setupGlobalErrorHandlers } from "./lib/log.ts";
import { OPENOBSERVE_TOKEN, OPENOBSERVE_URL } from "./generated/env.ts";

// @ts-ignore Deno Desktop API
const appVersion = Deno.desktopVersion || "0.0.0";

const RELEASE_BASE =
  "https://raw.githubusercontent.com/hugojosefson/deno-desktop-steamdeck/main/";

// --- Version helpers ---

function cmpVer(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

// --- Update state helpers ---

interface SentinelCheck {
  dir: string;
  dylibName: string;
  fullPath: string;
  update: boolean;
  backup: boolean;
  ok: boolean;
}

interface UpdateState {
  status:
    | "uptodate"
    | "update-available"
    | "update-staged"
    | "rollback-pending"
    | "update-was-applied"
    | "error";
  restartBehavior: string;
  message: string;
}

function parentDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : ".";
}

function listDirFiles(dir: string): string[] {
  try {
    const out: string[] = [];
    for (const e of Deno.readDirSync(dir)) {
      if (e.isFile) out.push(e.name);
    }
    return out;
  } catch {
    return [];
  }
}

function checkDylibSentinels(dylibPath: string): SentinelCheck | null {
  const updatePath = dylibPath + ".update";
  const backupPath = dylibPath + ".backup";
  const okPath = dylibPath + ".update-ok";

  let update = false,
    backup = false,
    ok = false;
  try {
    Deno.statSync(updatePath);
    update = true;
  } catch { /* no */ }
  try {
    Deno.statSync(backupPath);
    backup = true;
  } catch { /* no */ }
  try {
    Deno.statSync(okPath);
    ok = true;
  } catch { /* no */ }

  if (!update && !backup && !ok) return null;

  const i = dylibPath.lastIndexOf("/");
  const dir = i >= 0 ? dylibPath.slice(0, i) : ".";
  const dylibName = i >= 0 ? dylibPath.slice(i + 1) : dylibPath;

  return { dir, dylibName, fullPath: dylibPath, update, backup, ok };
}

function findLoadedDylibs(): string[] {
  try {
    const maps = Deno.readTextFileSync("/proc/self/maps");
    const paths = new Set<string>();
    for (const line of maps.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 6 && parts[5]) {
        const path = parts[5];
        if (
          path.startsWith("/") &&
          (path.endsWith(".so") || path.endsWith(".dylib"))
        ) {
          paths.add(path);
        }
      }
    }
    return [...paths];
  } catch (e) {
    console.error("[main] findLoadedDylibs failed:", e);
    return [];
  }
}

function deriveUpdateState(
  currentVersion: string,
  onlineVersion: string | null,
  checks: SentinelCheck[],
): UpdateState {
  const onlineAvailable = onlineVersion !== null &&
    cmpVer(onlineVersion, currentVersion) > 0;

  const withUpdate = checks.filter((c) => c.update);
  const withBackupNoOk = checks.filter((c) => c.backup && !c.ok);
  const withBackupAndOk = checks.filter((c) => c.backup && c.ok);

  if (withUpdate.length > 0) {
    const d = withUpdate[0];
    return {
      status: "update-staged",
      restartBehavior: `Update will be applied on the next restart (${
        onlineAvailable
          ? `v${currentVersion} → v${onlineVersion}`
          : "version unknown"
      }).`,
      message: onlineAvailable
        ? `Update v${onlineVersion} staged! Will apply on restart.`
        : `Update staged (${d.dir}/${d.dylibName}.update).`,
      ...(onlineAvailable ? { onlineVersion } : {}),
    };
  }

  if (withBackupNoOk.length > 0) {
    const d = withBackupNoOk[0];
    return {
      status: "rollback-pending",
      restartBehavior:
        `The last update failed to boot. On the next restart, the launcher will restore the previous dylib backup from ${d.dir}/${d.dylibName}.backup, rolling back to the version that was running before the failed update.`,
      message:
        `Last update failed! Will roll back on restart (backup at ${d.dir}/${d.dylibName}.backup).`,
    };
  }

  if (withBackupAndOk.length > 0) {
    const d = withBackupAndOk[0];
    return {
      status: "update-was-applied",
      restartBehavior:
        `A previous update was applied and booted successfully. On the next restart, the launcher will clean up the stale backup at ${d.dir}/${d.dylibName}.backup and the sentinel at ${d.dir}/${d.dylibName}.update-ok. No update action will be taken.`,
      message:
        `Update was applied and confirmed. Stale files will be cleaned up on next restart.`,
    };
  }

  if (onlineAvailable) {
    return {
      status: "update-available",
      restartBehavior:
        `Version v${onlineVersion} is available online at ${RELEASE_BASE}latest.json, but no update has been downloaded yet. Deno.autoUpdate() will check periodically (every 60 min) and download the update when it fires. No filesystem change will happen on restart until the update is staged. To trigger a check now, restart the app.`,
      message:
        `Update v${onlineVersion} available. Not downloaded yet; restart app to trigger auto-update check.`,
    };
  }

  return {
    status: "uptodate",
    restartBehavior:
      "No sentinel files found and no newer version online. The app will run as-is on the next restart.",
    message: "Up to date.",
  };
}

// --- Async check-update endpoint ---

async function handleCheckUpdate(): Promise<Response> {
  try {
    const [manifest, dylibs] = await Promise.all([
      fetch(RELEASE_BASE + "latest.json")
        .then((r) => r.json()).catch(() => null),
      findLoadedDylibs(),
    ]);
    const onlineVersion = manifest?.version ?? null;
    const onlineAvailable = onlineVersion !== null &&
      cmpVer(onlineVersion, appVersion) > 0;

    const sentinelResults = dylibs.map(checkDylibSentinels).filter(
      (r): r is SentinelCheck => r !== null,
    );
    const seen = new Set<string>();
    const sentinelChecks: SentinelCheck[] = [];
    for (const r of sentinelResults) {
      const key = r.dir + "/" + r.dylibName;
      if (!seen.has(key)) {
        seen.add(key);
        sentinelChecks.push(r);
      }
    }
    const knownDirs = new Set<string>();
    for (const d of dylibs) knownDirs.add(parentDir(d));
    try {
      knownDirs.add(parentDir(Deno.execPath()));
    } catch { /* skip */ }
    const appDir = Deno.env.get("APPDIR");
    if (appDir) knownDirs.add(appDir);
    for (const dir of knownDirs) {
      for (const name of listDirFiles(dir)) {
        if (name.endsWith(".so") || name.endsWith(".dylib")) {
          const r = checkDylibSentinels(dir + "/" + name);
          if (r && !seen.has(dir + "/" + name)) {
            seen.add(dir + "/" + name);
            sentinelChecks.push(r);
          }
        }
      }
    }
    const state = deriveUpdateState(appVersion, onlineVersion, sentinelChecks);
    await log("info", "check-update result", {
      currentVersion: appVersion,
      onlineVersion,
      onlineAvailable,
      sentinelFiles: sentinelChecks.map((s) => ({
        dir: s.dir,
        dylib: s.dylibName,
        update: s.update,
        backup: s.backup,
        ok: s.ok,
      })),
      status: state.status,
    });
    return Response.json({
      status: state.status,
      currentVersion: appVersion,
      onlineVersion,
      sentinel: sentinelChecks.length > 0
        ? sentinelChecks.map((s) => ({
          dir: s.dir,
          dylib: s.dylibName,
          updateExists: s.update,
          backupExists: s.backup,
          okExists: s.ok,
        }))
        : null,
      restartBehavior: state.restartBehavior,
      message: state.message,
    });
  } catch (e) {
    console.error("[main] /check-update error:", e);
    return Response.json({
      status: "error",
      message: String(e),
      restartBehavior: "Unknown; failed to check update state.",
    });
  }
}

const APP_NAME = "Hello Steam Deck";

// --- Game mode setup ---

function startAutoUpdate(): void {
  try {
    // @ts-ignore Deno Desktop API
    Deno.autoUpdate({ interval: 60 * 60 * 1000 });
  } catch (e) {
    logError("autoUpdate failed", e);
  }
}

const spinnerHtml = `<!DOCTYPE html>
<html>
<head>
<title>Hello Steam Deck</title>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#111;color:#eee;font-family:system-ui,sans-serif;text-align:center}
  .sp{width:40px;height:40px;border:4px solid #333;border-top:4px solid #888;border-radius:50%;animation:s 1s linear infinite;margin:0 auto 1rem}
  @keyframes s{to{transform:rotate(360deg)}}
  p{color:#666;font-size:.9rem}
</style>
</head>
<body><div><div class="sp"></div><p id="s">Starting v${appVersion}...</p></div></body>
</html>`;

const gameModeHtml = `<!DOCTYPE html>
<html>
<head>
<title>Hello Steam Deck</title>
<script src="https://browsersdk.openobserve.ai/0.3.4/openobserve-rum-slim.js" crossorigin="anonymous"></script>
<script>
  window._OO_LOG=function(l,m,d){try{fetch("${OPENOBSERVE_URL}/api/default/default/_json",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Basic "+btoa(":${OPENOBSERVE_TOKEN}")},body:JSON.stringify([Object.assign({timestamp:new Date().toISOString(),level:l,message:m},d||{})])}).catch(()=>{})}catch(e){}};
  (function(){var o=console.log,c=console.error;console.log=function(){o.apply(console,arguments);_OO_LOG("info",Array.from(arguments).join(" "))};console.error=function(){c.apply(console,arguments);_OO_LOG("error",Array.from(arguments).join(" "))};window.onerror=function(m,u,l,cl,e){_OO_LOG("error",m,{url:u||"",line:l||0,column:cl||0,stack:e?.stack||""})};window.addEventListener("unhandledrejection",function(e){_OO_LOG("error","unhandled rejection",{reason:String(e.reason),stack:e.reason?.stack||""})});try{if(window.OO_RUM)OO_RUM.init({applicationId:"com.hugojosefson.hello-steamdeck",clientToken:"${OPENOBSERVE_TOKEN}",site:"${
  new URL(OPENOBSERVE_URL).host
}",service:"hello-steamdeck",env:"production",version:"${
  "v" + appVersion
}",sessionSampleRate:100})}catch(e){console.error("OO_RUM init error:",e)}})();
</script>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#111;color:#eee;font-family:system-ui,sans-serif;text-align:center}
  h1{font-size:3rem;margin:0}
  p{font-size:1.2rem;color:#888}
  button{font-size:1rem;padding:.5em 1em;background:#333;color:#eee;border:1px solid #555;border-radius:4px;cursor:pointer;margin-top:1rem}
  button:hover{background:#444}
  #update-status{font-size:.9rem;margin-top:1rem}
  #version{font-size:.8rem;color:#444;margin-top:2rem}
  #feedback{font-size:.9rem;color:#666;margin-top:1rem}
</style>
<script>
  addEventListener("keydown",e=>{if(e.key==="Escape"||e.key==="b"||e.key==="B")window.close()});
  addEventListener("gamepadconnected",()=>{document.getElementById("feedback").textContent="Controller connected"});
  var v=document.getElementById("version");if(v)v.textContent="${
  "v" + appVersion
}";
  function poll(){requestAnimationFrame(()=>{for(var gp of navigator.getGamepads()){if(!gp)continue;if(gp.buttons[0]?.pressed){document.getElementById("feedback").textContent="A button pressed!"}if(gp.buttons[1]?.pressed){window.close()}};poll()})}
  addEventListener("gamepadconnected",poll);
  async function checkUpdate(){var s=document.getElementById("update-status");s.textContent="Checking...";try{var r=await(await fetch("/check-update")).json();var lines=[r.message||r.status];if(r.restartBehavior&&r.restartBehavior!==r.message)lines.push("("+r.restartBehavior+")");if(r.sentinel)for(var f of r.sentinel){var parts=[];if(f.updateExists)parts.push("update");if(f.backupExists)parts.push("backup");if(f.okExists)parts.push("ok");if(parts.length)lines.push("["+f.dylib+"] "+parts.join("+"))}s.textContent=lines.join("\\n");s.style.whiteSpace="pre-wrap"}catch(e){s.textContent="Error: "+e.message}}
</script>
</head>
<body>
<div>
  <h1>Hello Steam Deck!</h1>
  <p>Press B or Escape to close</p>
  <button onclick="checkUpdate()">Check for updates</button>
  <p id="update-status"></p>
  <p id="feedback"></p>
  <p id="version"></p>
</div>
</body>
</html>`;

async function startGameMode(): Promise<void> {
  // 1. Show spinner window immediately
  let win: { navigate: (url: string) => void } | null = null;
  try {
    // @ts-ignore Deno Desktop API
    win = new Deno.BrowserWindow({ title: "Hello Steam Deck" });
    win!.navigate("data:text/html;base64," + btoa(spinnerHtml));
  } catch (e) {
    console.error("[main] Deno.BrowserWindow not available:", e);
  }

  // 2. Run async setup while spinner shows
  setupGlobalErrorHandlers();
  startAutoUpdate();
  await log("info", "app starting", { version: appVersion });

  // 3. Start server with real UI
  Deno.serve(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/check-update") return await handleCheckUpdate();
    return new Response(gameModeHtml, {
      headers: { "content-type": "text/html" },
    });
  });

  // 4. Navigate window from spinner to real UI
  if (win) {
    try {
      const addr = Deno.env.get("DENO_SERVE_ADDRESS") || "tcp:127.0.0.1:8000";
      const port = addr.split(":").pop();
      win.navigate(`http://127.0.0.1:${port}/`);
    } catch (e) {
      console.error("[main] window navigate failed:", e);
    }
  }
}

// --- Main entry ---

async function main(): Promise<void> {
  // Desktop mode: no server, no window, no Chromium
  if (!isInGameMode() && !isLaunchedBySteam()) {
    const exePath = Deno.execPath();
    const appDir = exePath.substring(0, exePath.lastIndexOf("/"));
    const iconPath = `${appDir}/AppIcon.png`;
    const added = await ensureSteamDeckIntegration(exePath, iconPath);
    if (added) {
      const appId = computeAppId(APP_NAME);
      await switchToGameMode(appId);
    }
    return;
  }

  // Game mode: window + server
  await startGameMode();
}

await main();
