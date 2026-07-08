import { ensureSteamDeckIntegration } from "./steam-deck.ts";
import { log, logError, setupGlobalErrorHandlers } from "./lib/log.ts";
import { OPENOBSERVE_TOKEN, OPENOBSERVE_URL } from "./generated/env.ts";

function cmpVer(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

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
  // Rust logic: dylib_path.with_extension(format!("{}.update", ext))
  // For libdenort.so: ext="so", with_extension("so.update") = libdenort.so.update
  // That's equivalent to appending ".update" to the full path
  const updatePath = dylibPath + ".update";
  const backupPath = dylibPath + ".backup";
  const okPath = dylibPath + ".update-ok";

  let update = false,
    backup = false,
    ok = false;
  try {
    Deno.statSync(updatePath);
    update = true;
  } catch {
    // file does not exist
  }
  try {
    Deno.statSync(backupPath);
    backup = true;
  } catch {
    // file does not exist
  }
  try {
    Deno.statSync(okPath);
    ok = true;
  } catch {
    // file does not exist
  }

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
      // /proc/self/maps: addr perms offset dev inode pathname
      if (parts.length >= 6 && parts[5]) {
        const path = parts[5];
        // Only .so and no extension (main binary) paths, not anonymous maps
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

  // Find any dylib with sentinel files
  const withUpdate = checks.filter((c) => c.update);
  const withBackupNoOk = checks.filter((c) => c.backup && !c.ok);
  const withBackupAndOk = checks.filter((c) => c.backup && c.ok);

  // Update staged: .update exists (launcher will apply it on restart)
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

  // Rollback pending: .backup exists but no .update-ok
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

  // Update was applied and confirmed: .backup + .update-ok
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

  // No sentinel files — report online status
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

const RELEASE_BASE =
  "https://github.com/hugojosefson/deno-desktop-steamdeck/releases/latest/download/";

// @ts-ignore Deno Desktop API
const appVersion = Deno.desktopVersion || "0.0.0";

// Adopt the implicit startup window and show a spinner via data: URI
// before the HTTP server is even ready — avoids white screen
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
let win: { navigate: (url: string) => void } | null = null;
try {
  // @ts-ignore Deno Desktop API
  win = new Deno.BrowserWindow({ title: "Hello Steam Deck" });
  win!.navigate("data:text/html;base64," + btoa(spinnerHtml));
  console.error("[main] window showing spinner via data: URI");
} catch {
  console.error(
    "[main] Deno.BrowserWindow not available, server-based fallback",
  );
}

// Show spinner/loader immediately, before any async work
let pageHtml = spinnerHtml;

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/check-update") {
    console.error(`[main] /check-update request`);
    try {
      const [manifest, dylibs] = await Promise.all([
        fetch(RELEASE_BASE + "latest.json").then((r) => r.json()).catch(
          () => null,
        ),
        findLoadedDylibs(),
      ]);

      const onlineVersion = manifest?.version ?? null;
      const onlineAvailable = onlineVersion !== null &&
        cmpVer(onlineVersion, appVersion) > 0;

      // Check each loaded dylib for sentinel siblings
      const sentinelResults = dylibs.map(checkDylibSentinels).filter(
        (r): r is SentinelCheck => r !== null,
      );

      // Deduplicate by dir+dylibName
      const seen = new Set<string>();
      const sentinelChecks: SentinelCheck[] = [];
      for (const r of sentinelResults) {
        const key = r.dir + "/" + r.dylibName;
        if (!seen.has(key)) {
          seen.add(key);
          sentinelChecks.push(r);
        }
      }

      // Also check known directories directly
      const knownDirs = new Set<string>();
      for (const d of dylibs) knownDirs.add(parentDir(d));
      try {
        knownDirs.add(parentDir(Deno.execPath()));
      } catch {
        // Deno.execPath() not available
      }
      const appDir = Deno.env.get("APPDIR");
      if (appDir) knownDirs.add(appDir);

      for (const dir of knownDirs) {
        const names = listDirFiles(dir);
        for (const name of names) {
          if (name.endsWith(".so") || name.endsWith(".dylib")) {
            const r = checkDylibSentinels(dir + "/" + name);
            if (r && !seen.has(dir + "/" + name)) {
              seen.add(dir + "/" + name);
              sentinelChecks.push(r);
            }
          }
        }
      }

      // Derive combined state
      const state = deriveUpdateState(
        appVersion,
        onlineVersion,
        sentinelChecks,
      );

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

  return new Response(pageHtml, { headers: { "content-type": "text/html" } });
});

console.error(`[main] server started, appVersion=${appVersion}`);

setupGlobalErrorHandlers();

console.error(`[main] os=${Deno.build.os} arch=${Deno.build.arch}`);
console.error(`[main] denoVersion=${Deno.version.deno}`);
try {
  console.error(`[main] execPath=${Deno.execPath()}`);
} catch { /* skip */ }
try {
  console.error(`[main] cwd=${Deno.cwd()}`);
} catch { /* skip */ }
console.error(`[main] args=${JSON.stringify(Deno.args)}`);
for (
  const key of [
    "HOME",
    "USER",
    "PATH",
    "XDG_CURRENT_DESKTOP",
    "SteamAppId",
    "SteamGameId",
    "GAMESCOPE_VERSION",
    "STEAM_RUNTIME",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XDG_SESSION_TYPE",
    "APPIMAGE",
    "ARGV0",
    "APPDIR",
    "DESKTOPINTEGRATION_APPIMAGE",
    "DESKTOPINTEGRATION_ORIGINAL_ARGV0",
  ]
) {
  console.error(`[main] env.${key}=${Deno.env.get(key) ?? "(unset)"}`);
}
try {
  const allEnv = Deno.env.toObject();
  for (const key of Object.keys(allEnv).sort()) {
    if (
      key.includes("APPIMAGE") || key.includes("ARGV") ||
      key.includes("STEAM") || key.includes("GAMESCOPE") ||
      key.includes("DESKTOP")
    ) continue;
    const val = allEnv[key];
    if (val.length > 0 && val.length < 200) {
      console.error(`[main] allenv.${key}=${val}`);
    }
  }
} catch { /* skip */ }

await log("info", "app starting", { version: appVersion });
console.error("[main] initial log sent");

try {
  console.error("[main] calling Deno.autoUpdate");
  // @ts-ignore Deno Desktop API
  Deno.autoUpdate({ interval: 60 * 60 * 1000 });
  console.error("[main] Deno.autoUpdate succeeded");
} catch (e) {
  console.error(`[main] Deno.autoUpdate failed: ${e}`);
  logError("autoUpdate failed", e);
}

let shouldSkipMainServer = false;

try {
  console.error("[main] getting execPath");
  const appImagePath = Deno.env.get("APPIMAGE");
  const exePath = appImagePath || Deno.execPath();
  console.error(`[main] APPIMAGE env=${appImagePath ?? "(unset)"}`);
  console.error(`[main] exePath=${exePath}`);
  const appDir = exePath.substring(0, exePath.lastIndexOf("/"));
  const iconPath = `${appDir}/icons/512.png`;
  console.error(`[main] appDir=${appDir} iconPath=${iconPath}`);

  await log("info", "starting steam deck integration", {
    exePath,
    appDir,
    iconPath,
  });
  console.error("[main] logged 'starting steam deck integration'");

  console.error("[main] calling ensureSteamDeckIntegration");
  const result = await ensureSteamDeckIntegration(exePath, iconPath);
  console.error(
    `[main] ensureSteamDeckIntegration result: ${JSON.stringify(result)}`,
  );

  await log(
    "info",
    "steam deck integration result",
    result as unknown as Record<string, unknown>,
  );
  console.error("[main] logged result");

  if (result.needsRelaunch) {
    console.error(
      "[main] needsRelaunch=true, exiting for game mode switch",
    );
    pageHtml = `<!DOCTYPE html>
<html>
<head>
<title>Hello Steam Deck</title>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#111;color:#eee;font-family:system-ui,sans-serif;text-align:center}
  .sp{width:40px;height:40px;border:4px solid #333;border-top:4px solid #888;border-radius:50%;animation:s 1s linear infinite;margin:0 auto 1rem}
  @keyframes s{to{transform:rotate(360deg)}}
  p{color:#888;font-size:1rem}
</style>
</head>
<body><div><div class="sp"></div><p>Switching to game mode v${appVersion}...</p></div></body>
</html>`;
    shouldSkipMainServer = true;
    // Don't hold process open — game mode switch is underway
    setTimeout(() => Deno.exit(0), 2000);
  } else if (result.switchFailed) {
    pageHtml = `<!DOCTYPE html>
<html>
<head>
<title>Hello Steam Deck</title>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#111;color:#eee;font-family:system-ui,sans-serif;text-align:center}
  h1{font-size:2rem;margin:0}
  p{font-size:1rem;color:#888;max-width:400px}
  button{font-size:1rem;padding:.5em 1em;background:#333;color:#eee;border:1px solid #555;border-radius:4px;cursor:pointer;margin-top:1rem}
  button:hover{background:#444}
</style>
<script>
  addEventListener("keydown",e=>{if(e.key==="Escape"||e.key==="b"||e.key==="B")window.close()});
</script>
</head>
<body>
<div>
  <h1>Added to Steam</h1>
  <p>This app has been added to Steam as a non-Steam game. Please press the Steam button to switch to game mode, then find "Hello Steam Deck" in your library.</p>
  <button onclick="window.close()">Close</button>
</div>
</body>
</html>`;
    console.error("[main] switch failed, showing popup");
    shouldSkipMainServer = true;
  }
} catch (e) {
  console.error(`[main] Steam Deck integration error: ${e}`);
  if (e instanceof Error) console.error(`[main] stack: ${e.stack}`);
  logError("Steam Deck integration failed", e);
}

console.error(`[main] shouldSkipMainServer=${shouldSkipMainServer}`);
if (!shouldSkipMainServer) {
  console.error("[main] updating pageHtml to real UI");
  pageHtml = `<!DOCTYPE html>
<html>
<head>
<title>Hello Steam Deck</title>
<script src="https://browsersdk.openobserve.ai/0.3.4/openobserve-rum-slim.js" crossorigin="anonymous"></script>
<script>
  window._OO_LOG = function(lvl, msg, data) {
    try {
      fetch("${OPENOBSERVE_URL}/api/default/default/_json", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Basic " + btoa(":${OPENOBSERVE_TOKEN}")
        },
        body: JSON.stringify([Object.assign({timestamp: new Date().toISOString(), level: lvl, message: msg}, data || {})])
      }).catch(() => {});
    } catch(e) {}
  };
  (function() {
    const origLog = console.log;
    const origError = console.error;
    console.log = function() {
      origLog.apply(console, arguments);
      _OO_LOG("info", Array.from(arguments).join(" "));
    };
    console.error = function() {
      origError.apply(console, arguments);
      _OO_LOG("error", Array.from(arguments).join(" "));
    };
    window.onerror = function(msg, url, line, col, err) {
      _OO_LOG("error", msg, {url: url || "", line: line || 0, col: col || 0, stack: err?.stack || ""});
    };
    window.addEventListener("unhandledrejection", function(e) {
      _OO_LOG("error", "unhandled rejection", {reason: String(e.reason), stack: e.reason?.stack || ""});
    });
    try {
      if (window.OO_RUM) {
        OO_RUM.init({
          applicationId: "com.hugojosefson.hello-steamdeck",
          clientToken: "${OPENOBSERVE_TOKEN}",
          site: "${new URL(OPENOBSERVE_URL).host}",
          service: "hello-steamdeck",
          env: "production",
          version: "${"v" + appVersion}",
          sessionSampleRate: 100,
        });
      }
    } catch(e) {
      console.error("OO_RUM init error:", e);
    }
  })();
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
  const v=document.getElementById("version");
  if(v)v.textContent="${"v" + appVersion}";
  function poll(){requestAnimationFrame(()=>{for(const gp of navigator.getGamepads()){if(!gp)continue;if(gp.buttons[0]?.pressed){document.getElementById("feedback").textContent="A button pressed!"}if(gp.buttons[1]?.pressed){window.close()}};poll()})}
  addEventListener("gamepadconnected",poll);
  async function checkUpdate(){
    const s=document.getElementById("update-status");
    s.textContent="Checking...";
    try{
      const r=await(await fetch("/check-update")).json();
      const lines=[r.message||r.status];
      if(r.restartBehavior&&r.restartBehavior!==r.message)lines.push("("+r.restartBehavior+")");
      if(r.sentinel)for(const f of r.sentinel){
        const parts=[];
        if(f.updateExists)parts.push("update");
        if(f.backupExists)parts.push("backup");
        if(f.okExists)parts.push("ok");
        if(parts.length)lines.push("["+f.dylib+"] "+parts.join("+"));
      }
      s.textContent=lines.join("\n");
      s.style.whiteSpace="pre-wrap";
    }catch(e){s.textContent="Error: "+e.message}
  }
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
  console.error("[main] pageHtml updated to real UI");
  // Navigate the data: URI window back to the HTTP server for the real UI
  if (win) {
    try {
      const addr = Deno.env.get("DENO_SERVE_ADDRESS") || "tcp:127.0.0.1:8000";
      const port = addr.split(":").pop();
      win.navigate(`http://127.0.0.1:${port}/`);
      console.error(`[main] navigated window to http://127.0.0.1:${port}/`);
    } catch (e) {
      console.error("[main] window navigate failed:", e);
    }
  }
}
