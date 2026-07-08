# Agent instructions

## Git and release workflow

Complete workflow for every change:

1. **Pull and rebase with tags**: `git pull --rebase origin main` and
   `git fetch origin --prune` before any work
2. **Bump version**: update `version` in `deno.jsonc` to match planned tag (e.g.
   `0.3.19` for `v0.3.19`)
3. **Release build**: run `PREV_VERSION=<previous> deno task release` to build
   the AppImage, generate a bsdiff patch from the previous version's runtime
   dylib, and update `release/latest.json`. The previous version is the
   `Deno.desktopVersion` value baked into the last release (e.g. `0.3.18`). The
   previous runtime dylib must be present at `release/libdenort.so`.
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
automatically rebuilds the AppImage in CI, bumps the `version` in
`release/latest.json` while preserving patches, commits that bump to `main`, and
creates a GitHub Release with the AppImage artifact.

### GitHub Actions workflows

There are CI/CD workflows in `.github/workflows/`:

- **release.yml** — triggers on `v*` tag push; builds the AppImage via
  `deno task build`, bumps the `version` field in `release/latest.json` via
  `deno eval` (preserving existing patches), commits the bump to `main`, and
  creates a GitHub Release with the AppImage artifact.
- **ci.yml** — runs `deno task all` on non-`main` branches and PRs.

Note: the glob tool may not find these files since they're inside a `.github/`
directory.

### Release file checklist

Files to commit after a release:

- `deno.jsonc` (bumped version)
- `release/latest.json` (updated version + patch entry)
- `release/patch-<old>-to-<new>.bin` (new patch)
- `scripts/release.ts` (if changed)
- `deno.lock` (if changed)

Files NOT to commit (local-only build artifacts):

- `release/libdenort.so` (85MB baseline dylib, kept locally for next patch)
- `dist/` (build output, gitignored)

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

## Future improvements

- **Move patches to release assets**: bsdiff patches are currently stored in the
  repo (`release/patch-*.bin`) and served via `raw.githubusercontent.com`.
  Ideally they should be uploaded as GitHub Release assets and referenced by
  download URL in `latest.json`, so they don't depend on files staying in the
  repo. Implement once the auto-update system is verified working end-to-end.

## Agent maintenance

- Write new rules, conventions, and learnings to AGENTS.md as they arise

## Code style

- Run `deno fmt` before committing
- Use `deno lint` to catch issues
- Use `deno check` for type checking
