# 0.2.1

- Rename the npm package and CLI to `rulepacks`. Run `npx rulepacks` or
  install `rulepacks` to use the CLI. Existing configuration, locks, and
  generated file markers remain compatible.

- Add schema 2 package fragments, consumer composition, packs, immutable locks,
  safe transactions, project/global commands, migration, and static detection.
- Schema 2 replaces package-declared filesystem destinations with consumer
  outputs and local inputs. Schema 1 is supported only by the documented
  legacy path and narrow project migration; it is not written into v2 scopes.
- Published as `rulepacks@0.2.1`. The npm lifecycle runs the full check
  before publish and rebuilds `dist/` before packing.
