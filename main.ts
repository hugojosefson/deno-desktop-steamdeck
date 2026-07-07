Deno.serve(() =>
  new Response(
    `<!DOCTYPE html>
<html>
<head><title>Hello Steam Deck</title></head>
<body style="display:grid;place-items:center;height:100vh;margin:0;background:#111;color:#eee;font-family:system-ui,sans-serif">
  <h1>Hello Steam Deck!</h1>
  <p style="color:#888">Press Escape to close</p>
</body>
</html>`,
    { headers: { "content-type": "text/html" } },
  )
);
