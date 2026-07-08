# desktop-steamdeck

Minimal Deno Desktop hello-world app for Steam Deck, with auto-update and
controller support.

## Quick start (on Steam Deck)

Run the following in desktop mode. It will install the app and automatically add
it to Steam as a non-Steam game for game mode.

```sh
mkdir -p ~/hello-steamdeck
curl -sL https://github.com/hugojosefson/deno-desktop-steamdeck/releases/latest/download/hello.tar.gz | tar xz -C ~/hello-steamdeck
~/hello-steamdeck/hello
```

After installation, the app is available in game mode under the name **Hello
Steam Deck**.

## Usage (development)

```sh
# Build directory to dist/hello/
deno task build

# Format, lint, check
deno task all
```

## Release

```sh
# From a previous release's tag, build and patch
PREV_VERSION=<previous-version> deno task release
```

Creates `dist/hello.tar.gz`, `dist/latest.json`, and `dist/patch-*.bin`. Upload
these as GitHub release assets.

## Auto-update

The app checks for updates on startup and hourly via `Deno.autoUpdate()`.
Release manifests and patches are served from GitHub release assets at
`releases/latest/download/`.

The runtime dylib (`.so`) is patched in-place via bsdiff. Sentinel files
(`<dylib>.update`, `<dylib>.backup`, `<dylib>.update-ok`) track staged updates
and rollback state. Since the app builds to a directory (not an AppImage), the
dylib is in a writable location and auto-update works correctly.

## Requirements

- [Deno](https://deno.com/) v2.9+

## Backend

Uses the CEF backend (bundled Chromium) — no system libraries needed.
