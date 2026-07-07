#!/usr/bin/env bash
# add as dependency to your project
deno add jsr:@hugojosefson/desktop-steamdeck

# ...or...

# create and enter a directory for the script
mkdir -p "desktop-steamdeck"
cd       "desktop-steamdeck"

# download+extract the script, into current directory
curl -fsSL "https://github.com/hugojosefson/desktop-steamdeck/tarball/main" \
  | tar -xzv --strip-components=1
