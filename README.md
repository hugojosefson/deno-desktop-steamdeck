# desktop-steamdeck

[![JSR Version](https://jsr.io/badges/@hugojosefson/desktop-steamdeck)](https://jsr.io/@hugojosefson/desktop-steamdeck)
[![JSR Score](https://jsr.io/badges/@hugojosefson/desktop-steamdeck/score)](https://jsr.io/@hugojosefson/desktop-steamdeck)
[![CI](https://github.com/hugojosefson/desktop-steamdeck/actions/workflows/release.yaml/badge.svg)](https://github.com/hugojosefson/desktop-steamdeck/actions/workflows/release.yaml)

## Requirements

Requires [Deno](https://deno.com/) v2.9.1 or later.

_...or..._

- `/bin/sh`
- `unzip`
- `curl`

## API

Please see docs on
[jsr.io/@hugojosefson/desktop-steamdeck](https://jsr.io/@hugojosefson/desktop-steamdeck).

## Installation

```sh
# add as dependency to your project
deno add jsr:@hugojosefson/desktop-steamdeck

# ...or...

# create and enter a directory for the script
mkdir -p "desktop-steamdeck"
cd       "desktop-steamdeck"

# download+extract the script, into current directory
curl -fsSL "https://github.com/hugojosefson/desktop-steamdeck/tarball/main" \
  | tar -xzv --strip-components=1
```

## Example usage

```typescript
import { placeholder } from "@hugojosefson/desktop-steamdeck";

const result = placeholder();
console.dir({ result });
```

You may run the above example with:

```sh
deno run --reload jsr:@hugojosefson/desktop-steamdeck/example-usage
```

For further usage examples, see the tests:

- [test/placeholder.test.ts](test/placeholder.test.ts)
