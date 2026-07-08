const keys = ["OPENOBSERVE_URL", "OPENOBSERVE_TOKEN"];
const entries: string[] = [];

for (const key of keys) {
  let val: string | undefined;

  try {
    const envPath = `${import.meta.dirname}/../.env`;
    const text = await Deno.readTextFile(envPath);
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      if (trimmed.slice(0, eq).trim() === key) {
        val = trimmed.slice(eq + 1).trim();
        break;
      }
    }
  } catch {
    // .env file not found, try env vars instead
    val = Deno.env.get(key);
  }

  if (val) {
    entries.push(`export const ${key} = ${JSON.stringify(val)};`);
  }
}

const out = `// Auto-generated from .env — do not edit
${entries.join("\n")}
`;

const outPath = `${import.meta.dirname}/../generated/env.ts`;
await Deno.mkdir(`${import.meta.dirname}/../generated`, { recursive: true });
await Deno.writeTextFile(outPath, out);
