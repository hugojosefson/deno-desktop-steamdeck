import mod from "node-bsdiff";

const ROOT = `${import.meta.dirname}/..`;
const DIST_DIR = `${ROOT}/dist`;
const RELEASE_DIR = `${ROOT}/release`;
const OLD_LIB = `${RELEASE_DIR}/libdenort.so`;

async function sha256(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    data.buffer as ArrayBuffer,
  );
  const bytes = new Uint8Array(hash);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function main() {
  const configPath = `${ROOT}/deno.jsonc`;
  const configText = Deno.readTextFileSync(configPath);
  const version = configText.match(/"version"\s*:\s*"([^"]+)"/)?.[1];
  if (!version) {
    console.error("Could not read version from deno.jsonc");
    Deno.exit(1);
  }

  const backend = configText.match(/"backend"\s*:\s*"([^"]+)"/)?.[1] || "cef";

  console.error(`release: building v${version}...`);

  // Build directory format first (needed to extract libdenort.so)
  const buildDir = `${DIST_DIR}/hello-build`;
  const appImagePath = `${DIST_DIR}/hello.AppImage`;
  const finalAppImage = `${DIST_DIR}/hello`;
  await Deno.remove(DIST_DIR, { recursive: true }).catch(() => {});

  const dirBuild = new Deno.Command("deno", {
    args: [
      "desktop",
      "--allow-net",
      "--allow-run=steamosctl",
      "--allow-env",
      "--allow-write",
      "--allow-read",
      `--backend=${backend}`,
      `--output=${buildDir}`,
      `${ROOT}/main.ts`,
    ],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  let status = await dirBuild.output();
  if (!status.success) Deno.exit(1);

  // Grab the runtime shared library for patching
  // Find the main app .so (named after build dir, not libcef.so/libEGL.so/etc)
  const dirEntries = [];
  for await (const entry of Deno.readDir(buildDir)) {
    dirEntries.push(entry.name);
  }
  const appSo = dirEntries.find((n) =>
    n.endsWith(".so") && !n.startsWith("lib")
  );
  if (!appSo) {
    console.error("Could not find app .so in build directory");
    Deno.exit(1);
  }
  const newLibPath = `${buildDir}/${appSo}`;
  const newLib = await Deno.readFile(newLibPath);

  // Now build AppImage from the same source (deno desktop will rebuild)
  const appImageBuild = new Deno.Command("deno", {
    args: [
      "desktop",
      "--allow-net",
      "--allow-run=steamosctl",
      "--allow-env",
      "--allow-write",
      "--allow-read",
      `--backend=${backend}`,
      `--output=${appImagePath}`,
      `${ROOT}/main.ts`,
    ],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  status = await appImageBuild.output();
  if (!status.success) Deno.exit(1);

  // Clean up temp build dirs
  await Deno.remove(buildDir, { recursive: true }).catch(() => {});
  await Deno.remove(finalAppImage, { recursive: true }).catch(() => {});

  // Rename AppImage to final name
  await Deno.rename(appImagePath, finalAppImage);
  // Make executable
  await Deno.chmod(finalAppImage, 0o755);

  console.error(`release: built v${version}`);

  // Generate patch from previous lib if available
  const patches: Record<string, { name: string; sha256: string }> = {};
  const oldLibExists = await Deno.stat(OLD_LIB).then(() => true).catch(() =>
    false
  );

  if (oldLibExists) {
    const oldLib = await Deno.readFile(OLD_LIB);
    const fromVersion = Deno.env.get("PREV_VERSION") || "previous";
    const patchName = `patch-${fromVersion}-to-${version}.bin`;
    const patchBuf = mod.diff(oldLib, newLib);
    const hash = await sha256(patchBuf);
    patches[fromVersion] = { name: patchName, sha256: hash };
    await Deno.writeFile(`${RELEASE_DIR}/${patchName}`, patchBuf);
    console.error(
      `release: generated ${patchName} (${
        (patchBuf.length / 1024).toFixed(1)
      } KB)`,
    );
  } else {
    console.error("release: no previous libdenort.so found, skipping patch");
  }

  // Update latest.json — preserve existing patches, add new one
  const latestJsonPath = `${RELEASE_DIR}/latest.json`;
  let existing: { version?: string; patches?: Record<string, unknown> } = {};
  try {
    existing = JSON.parse(await Deno.readTextFile(latestJsonPath));
  } catch {
    // no existing file, start fresh
  }
  const merged = { ...existing.patches, ...patches };
  const latestJson = { version, patches: merged };
  await Deno.writeTextFile(
    latestJsonPath,
    JSON.stringify(latestJson, null, 2) + "\n",
  );
  console.error(`release: updated latest.json → version ${version}`);

  // Save new lib as baseline for NEXT release's patch
  await Deno.writeFile(OLD_LIB, newLib);
  console.error(`release: saved libdenort.so for next patch`);

  console.error(`release: v${version} complete`);
}

main();
