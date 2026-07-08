const envPath = `${import.meta.dirname}/../.env`;
const text = await Deno.readTextFile(envPath);

for (const line of text.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const val = trimmed.slice(eq + 1).trim();
  if (!key || !val) continue;

  const cmd = new Deno.Command("gh", {
    args: ["secret", "set", key, "--body", val],
  });
  const { code } = await cmd.spawn().status;
  if (code === 0) {
    console.log(`Set ${key}`);
  } else {
    console.error(`Failed to set ${key}`);
  }
}
