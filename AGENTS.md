# Agent instructions

## Git workflow

Complete workflow for every change:

1. **Pull and rebase**: `git pull --rebase origin main` before any work
2. **Validate**: run `deno task all` before every commit
3. **Commit**: `git add . && git commit -m "type: message"` (use conventional
   commits)
4. **Tag**: do a fresh `git pull --rebase origin main` to check for new tags
   from origin, then create tag with next semver version using
   `git tag -a vX.Y.Z -m "tag message"` (never delete tags)
5. **Push**: `git push origin main --tags`
6. **Handle rejections**: if push fails, run `git pull --rebase origin main`,
   check if a new tag was received from origin, and create a new tag if needed
   before retrying push

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
  `git pull --rebase origin main` to fetch the correct tag from origin

## Agent maintenance

- Write new rules, conventions, and learnings to AGENTS.md as they arise

## Code style

- Run `deno fmt` before committing
- Use `deno lint` to catch issues
- Use `deno check` for type checking
