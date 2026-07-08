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

const RELEASE_BASE =
  "https://raw.githubusercontent.com/hugojosefson/deno-desktop-steamdeck/main/release/";

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
<body><div><div class="sp"></div><p id="s">Starting...</p></div></body>
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
      const res = await fetch(RELEASE_BASE + "latest.json");
      const manifest = await res.json();
      const hasUpdate = cmpVer(manifest.version, appVersion) > 0;
      return Response.json({
        status: hasUpdate ? "available" : "uptodate",
        version: manifest.version,
      });
    } catch (e) {
      return Response.json({ status: "error", message: String(e) });
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
<body><div><div class="sp"></div><p>Switching to game mode...</p></div></body>
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
      s.textContent=r.status==="available"?"Update v"+r.version+" available! Restart to apply":r.status==="uptodate"?"Up to date":"Error: "+r.message;
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
