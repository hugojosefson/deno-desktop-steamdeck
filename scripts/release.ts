import mod from "node-bsdiff";

const ROOT = `${import.meta.dirname}/..`;
const DIST_DIR = `${ROOT}/dist`;
const BUILD_DIR = `${DIST_DIR}/hello`;
const GH_OWNER = "hugojosefson";
const GH_REPO = "deno-desktop-steamdeck";

async function sha256(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    data.buffer as ArrayBuffer,
  );
  const bytes = new Uint8Array(hash);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readVersion(): string {
  const configText = Deno.readTextFileSync(`${ROOT}/deno.jsonc`);
  const m = configText.match(/"version"\s*:\s*"([^"]+)"/);
  if (!m) {
    console.error("version not found in deno.jsonc");
    Deno.exit(1);
  }
  return m[1];
}

function findAppSo(dir: string): string {
  const names: string[] = [];
  for (const e of Deno.readDirSync(dir)) {
    if (e.isFile) names.push(e.name);
  }
  const so = names.find((n) => n.endsWith(".so") && !n.startsWith("lib"));
  if (!so) {
    console.error(`no app .so found in ${dir} (files: ${names.join(", ")})`);
    Deno.exit(1);
  }
  return `${dir}/${so}`;
}

async function main() {
  const version = readVersion();
  const prevVersion = Deno.env.get("PREV_VERSION");
  console.error(
    `release: v${version}${
      prevVersion ? ` (prev: ${prevVersion})` : " (no prev)"
    }`,
  );

  // Generate env + clean
  const genEnv = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      `${ROOT}/scripts/build-env.ts`,
    ],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const genStatus = await genEnv.output();
  if (!genStatus.success) Deno.exit(1);

  await Deno.remove(DIST_DIR, { recursive: true }).catch(() => {});
  const build = new Deno.Command("deno", {
    args: [
      "desktop",
      "--allow-net",
      "--allow-run=steamosctl",
      "--allow-env",
      "--allow-write",
      "--allow-read",
      `${ROOT}/main.ts`,
    ],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await build.output();
  if (!status.success) Deno.exit(1);

  // Grab the app .so for patching
  const newLibPath = findAppSo(BUILD_DIR);
  const newLib = await Deno.readFile(newLibPath);
  console.error(`release: built, app .so = ${newLibPath}`);

  // Create hello.tar.gz from build dir (flattened: contents extract to ./)
  const tarCmd = new Deno.Command("tar", {
    args: ["czf", `${DIST_DIR}/hello.tar.gz`, "--owner=0", "--group=0", "."],
    cwd: BUILD_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });
  const tarStatus = await tarCmd.output();
  if (!tarStatus.success) Deno.exit(1);
  console.error(`release: created ${DIST_DIR}/hello.tar.gz`);

  // Generate patch from previous release if available
  const patches: Record<string, { name: string; sha256: string }> = {};
  if (prevVersion) {
    const prevUrl =
      `https://github.com/${GH_OWNER}/${GH_REPO}/releases/download/v${prevVersion}/hello.tar.gz`;
    console.error(
      `release: downloading previous v${prevVersion} from ${prevUrl}`,
    );

    const resp = await fetch(prevUrl);
    if (!resp.ok) {
      console.error(
        `release: failed to download previous release: ${resp.status}`,
      );
      Deno.exit(1);
    }

    // Extract to temp dir
    const tmpDir = `${DIST_DIR}/.prev-extract`;
    await Deno.mkdir(tmpDir, { recursive: true });
    const prevTar = await resp.bytes();
    await Deno.writeFile(`${tmpDir}/prev.tar.gz`, prevTar);

    const extract = new Deno.Command("tar", {
      args: ["xzf", `${tmpDir}/prev.tar.gz`, "-C", tmpDir],
      stdout: "inherit",
      stderr: "inherit",
    });
    const extStatus = await extract.output();
    if (!extStatus.success) Deno.exit(1);

    const prevLibPath = findAppSo(tmpDir);
    const prevLib = await Deno.readFile(prevLibPath);
    console.error(`release: previous .so = ${prevLibPath}`);

    // Generate patch
    const patchName = `patch-${prevVersion}-to-${version}.bin`;
    const patchBuf = mod.diff(prevLib, newLib);
    const hash = await sha256(patchBuf);
    patches[prevVersion] = { name: patchName, sha256: hash };
    await Deno.writeFile(`${DIST_DIR}/${patchName}`, patchBuf);
    console.error(
      `release: ${patchName} (${(patchBuf.length / 1024).toFixed(1)} KB)`,
    );

    // Cleanup temp
    await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
  } else {
    console.error("release: no PREV_VERSION, skipping patch");
  }

  // Write latest.json
  const latestJson = { version, patches };
  await Deno.writeTextFile(
    `${DIST_DIR}/latest.json`,
    JSON.stringify(latestJson, null, 2) + "\n",
  );
  console.error(`release: wrote latest.json → version ${version}`);

  // Summary of release assets
  const assets = [`${DIST_DIR}/hello.tar.gz`, `${DIST_DIR}/latest.json`];
  for (const [fromVer] of Object.entries(patches)) {
    assets.push(`${DIST_DIR}/patch-${fromVer}-to-${version}.bin`);
  }
  for (const a of assets) {
    const s = await Deno.stat(a);
    console.error(`release: asset ${a} (${(s.size / 1024).toFixed(1)} KB)`);
  }

  console.error(`release: v${version} complete`);
}

main();
