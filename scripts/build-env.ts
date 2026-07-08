const envPath = `${import.meta.dirname}/../.env`;
const text = await Deno.readTextFile(envPath);

const lines = text.split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

const entries: string[] = [];
for (const line of lines) {
  const eq = line.indexOf("=");
  if (eq === -1) continue;
  const key = line.slice(0, eq).trim();
  const val = line.slice(eq + 1).trim();
  entries.push(`export const ${key} = ${JSON.stringify(val)};`);
}

const out = `// Auto-generated from .env — do not edit
${entries.join("\n")}
`;

const outPath = `${import.meta.dirname}/../generated/env.ts`;
await Deno.mkdir(`${import.meta.dirname}/../generated`, { recursive: true });
await Deno.writeTextFile(outPath, out);
