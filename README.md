# desktop-steamdeck

Minimal Deno Desktop hello-world app for Steam Deck, with auto-update and
controller support.

## Quick start (on Steam Deck)

```sh
curl -sL https://github.com/hugojosefson/deno-desktop-steamdeck/releases/latest/download/hello -o hello
chmod +x hello
./hello
```

To add as a non-Steam game in game mode: add `./hello` as a non-Steam game via
the Steam client.

## Usage (development)

```sh
# Run in development
deno task dev

# Build AppImage for Steam Deck
deno task build

# Format, lint, check
deno task all
```

## Auto-update

The app checks for updates on startup and hourly via `Deno.autoUpdate()`. The
release manifest lives in [release/latest.json](release/latest.json). New
releases publish AppImages to GitHub Releases.

## Requirements

- [Deno](https://deno.com/) v2.9+

## Backend

Uses the CEF backend (bundled Chromium) — no system libraries needed.
