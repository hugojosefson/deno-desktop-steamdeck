// @ts-ignore Deno Desktop API
const appVersion = Deno.desktopVersion || "0.0.0";

// @ts-ignore Deno Desktop API
Deno.autoUpdate({ interval: 60 * 60 * 1000 });

Deno.serve(() =>
  new Response(
    `<!DOCTYPE html>
<html>
<head>
<title>Hello Steam Deck</title>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#111;color:#eee;font-family:system-ui,sans-serif;text-align:center}
  h1{font-size:3rem;margin:0}
  p{font-size:1.2rem;color:#888}
  #version{font-size:.8rem;color:#444;margin-top:3rem}
  #feedback{font-size:.9rem;color:#666;margin-top:1rem}
</style>
<script>
  addEventListener("keydown",e=>{if(e.key==="Escape")window.close()});
  addEventListener("gamepadconnected",()=>{document.getElementById("feedback").textContent="Controller connected"});
  const v=document.getElementById("version");
  if(v)v.textContent="${"v" + appVersion}";
  function poll(){requestAnimationFrame(()=>{for(const gp of navigator.getGamepads()){if(gp&&gp.buttons[0]?.pressed){document.getElementById("feedback").textContent="A button pressed!"}};poll()})}
  addEventListener("gamepadconnected",poll);
</script>
</head>
<body>
<div>
  <h1>Hello Steam Deck!</h1>
  <p>Press B or Escape to close</p>
  <p id="feedback"></p>
  <p id="version"></p>
</div>
</body>
</html>`,
    { headers: { "content-type": "text/html" } },
  )
);
