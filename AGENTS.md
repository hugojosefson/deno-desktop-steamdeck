# Agent instructions

## Git workflow

- Always `git pull --rebase origin main` before tagging and pushing
- Run `deno task all` before every commit
- Commit, tag, and push as a complete workflow:
  1. `git add . && git commit -m "type: message"`
  2. `git tag -a vX.Y.Z -m "tag message"`
  3. `git push origin main --tags`

## Deno permissions

- Never add deno permissions without explicit user permission
- Be specific with permissions (e.g., `--allow-run=steamosctl`, not `--allow-run`)
- Avoid blanket permissions like `--allow-all`
- Set deno permissions in the build task of `deno.jsonc` for Deno Desktop apps

## Versioning

- Use semver for tags (vX.Y.Z)
- Major version (X): breaking changes
- Minor version (Y): new features
- Patch version (Z): bug fixes

## Code style

- Run `deno fmt` before committing
- Use `deno lint` to catch issues
- Use `deno check` for type checking
