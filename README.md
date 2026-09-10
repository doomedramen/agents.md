# agents.md

Git-native package manager for AI coding-agent instruction files.

The CLI is distributed through npm:

```sh
npx agents.md add @doomedramen/agents-nextjs
```

`@owner/repo` is parsed as a GitHub source reference. The package's
`agent.yaml` declares whether each target is project-local or global, so the
CLI does not take a scope flag. `add` replaces the package-declared targets
and records the source commit in the relevant state and lock files.

## Development

```sh
npm install
npm run check
npm run build
```
