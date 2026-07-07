# desktop-steamdeck

Minimal Deno Desktop hello-world app for Steam Deck, with auto-update and
controller support.

## Usage

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
