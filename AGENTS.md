# Agent instructions

## Git and release workflow

Complete workflow for every change:

1. **Pull and rebase with tags**: `git pull --rebase origin main` and
   `git fetch origin --prune` before any work
2. **Bump version**: update `version` in `deno.jsonc` to match planned tag (e.g.
   `0.3.19` for `v0.3.19`)
3. **Release build**: run `PREV_VERSION=<previous> deno task release` to build
   the app to `dist/hello/`, generate a bsdiff patch, package `hello.tar.gz`,
   and write `dist/latest.json`. The previous version is the
   `Deno.desktopVersion` value baked into the last release (e.g. `0.3.18`). The
   previous release's `hello.tar.gz` is downloaded from GitHub release assets.
4. **Validate**: run `deno task all` before every commit
5. **Commit**: `git add . && git commit -m "type: message"` (use conventional
   commits)
6. **Tag**: do a fresh `git pull --rebase origin main` to check for new tags
   from origin (use `git fetch origin --prune` to actually fetch them), then
   create tag with next semver version using
   `git tag -a vX.Y.Z -m "tag message"` (never delete tags)
7. **Push**: `git push origin main --tags`
8. **Handle rejections**: if push fails, run `git pull --rebase origin main`,
   check if a new tag was received from origin (`git fetch origin --prune`), and
   create a new tag if needed before retrying push

After pushing a `v*` tag, the **release.yml** GitHub Actions workflow
automatically runs `deno task release`, then creates a GitHub Release with the
build artifacts (`hello.tar.gz`, `latest.json`, `patch-*.bin`) attached.

### GitHub Actions workflows

There are CI/CD workflows in `.github/workflows/`:

- **release.yml** — triggers on `v*` tag push; runs `deno task release` to build
  and generate patches, then creates a GitHub Release with the build artifacts
  (`hello.tar.gz`, `latest.json`, `patch-*.bin`) attached.
- **ci.yml** — runs `deno task all` on non-`main` branches and PRs.

Note: the glob tool may not find these files since they're inside a `.github/`
directory.

### Release file checklist

Files to commit after a release:

- `deno.jsonc` (bumped version)
- `scripts/release.ts` (if changed)
- `deno.lock` (if changed)

Files NOT to commit (local-only build artifacts):

- `dist/` (build output, gitignored)

### Release assets (uploaded by CI to GitHub Release)

- `hello.tar.gz` — app directory contents packed (extracts to `./`)
- `latest.json` — update manifest for `Deno.autoUpdate()`
- `patch-<old>-to-<new>.bin` — bsdiff patch for the runtime dylib

## Deno permissions

- Never add deno permissions without explicit user permission
- Be specific with permissions (e.g., `--allow-run=steamosctl`, not
  `--allow-run`)
- Avoid blanket permissions like `--allow-all`
- Set deno permissions in the build task of `deno.jsonc` for Deno Desktop apps

## Versioning

- Use semver for tags (vX.Y.Z)
- Major version (X): breaking changes
- Minor version (Y): new features
- Patch version (Z): bug fixes
- Never delete tags - create next tag instead
- If a local tag disagrees with origin (e.g., created by a failed partial push),
  origin wins: delete the local tag with `git tag -d vX.Y.Z`, then
  `git pull --rebase origin main` to fetch the correct tag from origin (use
  `git fetch origin --prune` to ensure you actually get the remote tags)

## Agent maintenance

- Write new rules, conventions, and learnings to AGENTS.md as they arise

## Token and tool efficiency

- Use `gh run watch --exit-status` to wait for CI to finish, filtering out the
  verbose per-job lines:
  `gh run watch --exit-status 2>&1 | rg -v '^\*|^\s|^$|(Set up|Post |Run actions|Run denoland|Verify|Create)'`
  This keeps only the completion/error summary lines.
- Prefer one-shot checks over polling loops
- Batch independent operations into parallel tool calls

## Code style

- Run `deno fmt` before committing
- Use `deno lint` to catch issues
- Use `deno check` for type checking
