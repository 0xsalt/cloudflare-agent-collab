# api

The api canonical serves the observatory feed. `feed.ts` is a one-file Worker that reads the
control Worker's `/api/state` and returns one feed item per push event.

## Test

```sh
bun test
```

The one test, "feed timestamps are ISO-8601", is the admission check for this canonical. A
candidate that leaves it red is sent back.

## Contributing

Read `CONTRACT.md` in the spec canonical. A change reaches this repository only as a candidate
fork that the admission authority admits. Reserved paths: `wrangler.jsonc`, `feed.test.ts`,
`package.json`, `bunfig.toml`.
