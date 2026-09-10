# agents.md

`agents.md` installs versioned coding-agent instructions from Git repositories.
Package authors keep one canonical `AGENTS.md`, then declare each tool-specific
destination in `agent.yaml`. The CLI records the source commit and installed file
hashes in `agents.yaml` and `agents.lock`.

## Requirements

- Node.js 20 or newer
- Git

## Install a package

Run `add` from the repository that should receive the instructions:

```sh
npx @doomedramen/agents.md add github:doomedramen/agent-packages#packages/project-typescript
```

The CLI accepts GitHub shorthand, HTTPS URLs, and SSH URLs:

```sh
npx @doomedramen/agents.md add @acme/agent-files
npx @doomedramen/agents.md add github:acme/agent-files#packages/nextjs
npx @doomedramen/agents.md add https://github.com/acme/agent-files.git#packages/nextjs
npx @doomedramen/agents.md add git@github.com:acme/agent-files.git
```

`@owner/repo` refers to a GitHub repository. The CLI checks out the repository;
it does not install an npm dependency from that source.

The package manifest controls installation scope. There are no `--project` or
`--global` flags.

## Package format

Each package needs an `agent.yaml` manifest and at least one instruction file:

```text
my-agent-package/
├── agent.yaml
└── AGENTS.md
```

This manifest installs `AGENTS.md` into a project and creates a Claude Code
adapter that imports the same file:

```yaml
schema: 1
name: typescript-project
description: Project instructions for TypeScript repositories
canonical:
  source: AGENTS.md
files:
  - source: AGENTS.md
    targets:
      - scope: project
        path: AGENTS.md
        mode: direct
      - scope: project
        agent: claude-code
        path: CLAUDE.md
        mode: import
        import: AGENTS.md
```

Use `mode: direct` to copy a file. Use `mode: import` to write an adapter for a
tool that supports imports. Import targets require `canonical.source`.

Keep package paths relative to the package directory. The CLI rejects paths that
escape their allowed root, duplicate destinations, and destination symlinks.

## Installation scopes

| Scope | Manifest fields | Example destination |
| --- | --- | --- |
| Project | `scope: project` | `./AGENTS.md` |
| Global | `scope: global` and `agent` | `~/.codex/AGENTS.md` |

A package can include project and global targets. The CLI updates state files for
each scope used by the package.

Global instructions affect every project that reads them. Review the source files
before installing a global package:

```sh
npx @doomedramen/agents.md add github:doomedramen/agent-packages#packages/global-baseline
```

## Files written by `add`

For each declared target, `add`:

1. Fetches the source repository and resolves a Git commit.
2. Reads and validates `agent.yaml`.
3. Replaces the destination file.
4. Updates the matching manifest and lockfile with the source commit and hashes.

`add` replaces files owned by the package. It does not merge Markdown or run
package scripts.

## Reference packages

The [agent-packages repository](https://github.com/doomedramen/agent-packages)
contains working project and global packages:

- [TypeScript project manifest](https://github.com/doomedramen/agent-packages/blob/main/packages/project-typescript/agent.yaml)
- [TypeScript project instructions](https://github.com/doomedramen/agent-packages/blob/main/packages/project-typescript/AGENTS.md)
- [Global baseline manifest](https://github.com/doomedramen/agent-packages/blob/main/packages/global-baseline/agent.yaml)
- [Global baseline instructions](https://github.com/doomedramen/agent-packages/blob/main/packages/global-baseline/AGENTS.md)

## Development

```sh
npm install
npm run check
npm run build
```

Source code lives in [`src/`](src/). See [`SPEC.md`](SPEC.md) for the package
format, security rules, state model, and planned Git-backed package index.

## Further reading

- [Codex `AGENTS.md` guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Claude Code memory and imports](https://code.claude.com/docs/en/memory)
- [OpenAI Codex instructions](https://github.com/openai/codex/blob/main/AGENTS.md)
- [Vercel AI SDK instructions](https://github.com/vercel/ai/blob/main/AGENTS.md)
- [WordPress Contributor Toolkit instructions](https://github.com/WordPress/contributor-toolkit/blob/trunk/AGENTS.md)
