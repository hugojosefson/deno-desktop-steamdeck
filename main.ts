import { ensureSteamDeckIntegration } from "./steam-deck.ts";
import { log, logError, setupGlobalErrorHandlers } from "./lib/log.ts";

setupGlobalErrorHandlers();

// @ts-ignore Deno Desktop API
const appVersion = Deno.desktopVersion || "0.0.0";

let shouldSkipMainServer = false;

await log("info", "app starting", { version: appVersion });

try {
  // @ts-ignore Deno Desktop API
  Deno.autoUpdate({ interval: 60 * 60 * 1000 });
} catch (e) {
  logError("autoUpdate failed", e);
}

try {
  const exePath = Deno.execPath();
  const appDir = exePath.substring(0, exePath.lastIndexOf("/"));
  const iconPath = `${appDir}/icons/512.png`;

  await log("info", "starting steam deck integration", {
    exePath,
    appDir,
    iconPath,
  });

  const result = await ensureSteamDeckIntegration(exePath, iconPath);

  await log(
    "info",
    "steam deck integration result",
    result as unknown as Record<string, unknown>,
  );

  if (result.needsRelaunch) {
    shouldSkipMainServer = true;
  } else if (result.switchFailed) {
    const popupHtml = `<!DOCTYPE html>
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
  addEventListener("keydown",e=>{if(e.key==="Escape")window.close()});
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
    Deno.serve(() =>
      new Response(popupHtml, { headers: { "content-type": "text/html" } })
    );
    shouldSkipMainServer = true;
  }
} catch (e) {
  logError("Steam Deck integration failed", e);
}

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

if (!shouldSkipMainServer) {
  Deno.serve(async (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/check-update") {
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

    return new Response(
      `<!DOCTYPE html>
<html>
<head>
<title>Hello Steam Deck</title>
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
  addEventListener("keydown",e=>{if(e.key==="Escape")window.close()});
  addEventListener("gamepadconnected",()=>{document.getElementById("feedback").textContent="Controller connected"});
  const v=document.getElementById("version");
  if(v)v.textContent="${"v" + appVersion}";
  function poll(){requestAnimationFrame(()=>{for(const gp of navigator.getGamepads()){if(gp&&gp.buttons[0]?.pressed){document.getElementById("feedback").textContent="A button pressed!"}};poll()})}
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
</html>`,
      { headers: { "content-type": "text/html" } },
    );
  });
}
