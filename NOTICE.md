# Third-party notices

This repository ships no third-party code. `bun install` fetches the development tools below
from npm under their own licenses; `bun.lock` pins every transitive package.

| Package | Version | License |
| --- | --- | --- |
| @cloudflare/workers-types | ? | UNKNOWN |
| @types/bun | ? | UNKNOWN |
| wrangler | ? | UNKNOWN |

Some transitive packages carry other licenses: for example, `sharp`, through miniflare, loads
libvips under LGPL-3.0. They are installed on a developer's machine and never redistributed here.
