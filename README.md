# agents.md

Install versioned instructions for coding agents from Git.

`agents.md` keeps one canonical `AGENTS.md` in a Git repository and renders
native adapters for tools such as Claude Code. Each package includes an
`agent.yaml` file that declares its project and global targets. The CLI records
the source commit and rendered file hashes in reviewable state files.

## Install

You need Node.js 20 or newer and Git.

```sh
npx @doomedramen/agents.md add github:acme/agent-files#packages/nextjs
```

The command accepts GitHub shorthands and Git URLs:

```sh
npx @doomedramen/agents.md add @acme/agent-files
npx @doomedramen/agents.md add github:acme/agent-files#packages/nextjs
npx @doomedramen/agents.md add https://github.com/acme/agent-files.git#packages/nextjs
npx @doomedramen/agents.md add git@github.com:acme/agent-files.git
```

`@owner/repo` names a GitHub source. The CLI fetches that repository as a Git
checkout; it does not install an npm dependency.

## Try the reference packages

The [reference package repository](https://github.com/doomedramen/agent-packages)
contains installable examples for project and global instructions. Each package
declares its scope in `agent.yaml`.

### Project instructions

Run this command from a Git repository:

```sh
npx @doomedramen/agents.md add github:doomedramen/agent-packages#packages/project-typescript
```

The package writes `AGENTS.md`, a Claude import adapter, `agents.yaml`, and
`agents.lock` in the current repository.

Open the package files:

- [Project manifest](https://github.com/doomedramen/agent-packages/blob/main/packages/project-typescript/agent.yaml)
- [Project instructions](https://github.com/doomedramen/agent-packages/blob/main/packages/project-typescript/AGENTS.md)

### Global instructions

Review the file before installing it. A global package changes the files that
your agents read across projects.

```sh
npx @doomedramen/agents.md add github:doomedramen/agent-packages#packages/global-baseline
```

The package writes Codex guidance to `~/.codex/AGENTS.md`, Claude guidance to
`~/.claude/AGENTS.md` and `~/.claude/CLAUDE.md`, and global state under the
configured agents directory.

Open the package files:

- [Global manifest](https://github.com/doomedramen/agent-packages/blob/main/packages/global-baseline/agent.yaml)
- [Global instructions](https://github.com/doomedramen/agent-packages/blob/main/packages/global-baseline/AGENTS.md)

The package manifest sets the scope. The command has no `--global` or
`--project` flag.

## How targets work

| Scope | Manifest fields | Example destination |
| --- | --- | --- |
| Project | `scope: project` | `./AGENTS.md` or `./CLAUDE.md` |
| Global | `scope: global` and `agent` | `~/.codex/AGENTS.md` or `~/.claude/CLAUDE.md` |

One package can declare targets in both scopes. `add` installs each declared
target and updates the matching project or global state files.

Keep instructions in one canonical file:

```text
AGENTS.md       canonical instructions
CLAUDE.md       @AGENTS.md
```

Claude Code expands `@AGENTS.md`; Codex reads `AGENTS.md` directly. The
adapter contains one import line, so the two tools share the same instructions.

## Author a package

Use this layout:

```text
my-agent-package/
├── agent.yaml
└── AGENTS.md
```

Declare the source file and its destinations in `agent.yaml`:

```yaml
schema: 1
name: typescript-project
description: Project instructions for a TypeScript repository
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

Use `mode: direct` for a file copy. Use `mode: import` for the Claude adapter.
The manifest must declare `canonical.source` for import targets. Keep paths
relative to the package and the consuming project.

## What `add` does

1. Fetches the package through Git.
2. Reads and validates `agent.yaml`.
3. Replaces each declared target at its project or global destination.
4. Writes the matching state and lock files with the resolved commit and file hashes.

`add` replaces an existing declared target, including `AGENTS.md`. It rejects
unsafe paths, duplicate destinations, and target symlinks. It does not merge
Markdown files or run package scripts.

The MVP resolves direct Git sources. The Git-backed package index described in
[SPEC.md](SPEC.md) will provide named discovery in a later phase.

## Public references

The reference packages use patterns from these public sources:

- [Codex instructions and scope](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Claude Code memory and imports](https://code.claude.com/docs/en/memory)
- [OpenAI Agents Python `AGENTS.md`](https://github.com/openai/openai-agents-python/blob/main/AGENTS.md)
- [OpenAI Codex `AGENTS.md`](https://github.com/openai/codex/blob/main/AGENTS.md)
- [Vercel AI SDK `AGENTS.md`](https://github.com/vercel/ai/blob/main/AGENTS.md)
- [WordPress Contributor Toolkit `AGENTS.md`](https://github.com/WordPress/contributor-toolkit/blob/trunk/AGENTS.md)
- [Codex global template](https://github.com/yuanguang-ai-lab/codex-global-agents-template/blob/main/AGENTS.md)
- [Skills documentation](https://www.skills.sh/docs) for GitHub-native package discovery.

The reference files are original compositions. The package repository keeps
their manifests and source files together so the commands above install the
same files shown in the documentation.

## Development

```sh
npm install
npm run check
npm run build
```

The CLI source lives in [`src/`](src/). The npm package is
`@doomedramen/agents.md`; its `bin` entry exposes the `agents.md` executable.
