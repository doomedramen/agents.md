# agents.md

Build your project's `AGENTS.md` from reusable instructions and local project
notes.

`agents.md` is a command-line tool for managing coding-agent guidance. Choose
Markdown instructions from Git repositories, add the facts specific to your
project, and generate one `AGENTS.md` containing the full text.

Requires **Node.js 20+ and Git**. Run it with `npx`; no separate installation is
needed.

## Why use it?

Several projects often need the same guidance: TypeScript conventions, framework
rules, UI library patterns, or team standards. Copying those instructions into
every project makes updates hard to track.

Keep shared guidance in one Git repository instead. Each project selects what it
needs, keeps its own notes locally, and locks the shared sources to exact commits.
You can review an update before applying it.

The generated `AGENTS.md` contains the instructions themselves. Agents do not
need to follow paths to the shared source files. The tool manages those files;
your coding agent decides how to load and follow the resulting guidance.

## Get started

Run these commands from your project directory:

```sh
# Create the configuration and project notes.
npx @doomedramen/agents.md init

# Add shared TypeScript guidance from a public Git repository.
npx @doomedramen/agents.md add github:doomedramen/agent-packages#packages/project-typescript --ref main
```

Already have an `AGENTS.md`? Use `init --adopt` for the first command. It preserves
a backup and copies your existing instructions into the local project notes.
Custom `CLAUDE.md` content must be reconciled before adoption.

Open `.agents/project.md` in your editor. Add your project's commands, important
paths, architecture, and any exceptions to the shared rules. Then rebuild and
verify:

```sh
npx @doomedramen/agents.md render
npx @doomedramen/agents.md check
```

You now have shared guidance and your project notes together in `AGENTS.md`.
Review the changes and commit the files listed below. The example uses `main`
for convenience; use a reviewed tag or commit when you want to pin the selected
version explicitly. The lockfile records the exact commit either way.

## What goes where?

| File | Purpose | Edit it? |
| --- | --- | --- |
| `agents.yaml` | Selects shared sources and which instructions to include | Yes |
| `.agents/project.md` | Your project's commands, structure, and specific rules | Yes |
| `agents.lock` | Records source commits and file hashes for reproducible output | Generated |
| `AGENTS.md` | Full instructions for your coding agent | Generated |
| `CLAUDE.md` | Imports `AGENTS.md` for Claude Code | Generated |

Commit all five files so teammates and CI use the same guidance. Edit the source
Markdown or local notes, then run `render`; editing the generated `AGENTS.md`
directly causes drift that `check` reports.

A **package** is a set of shared Markdown files, called **fragments**. Each
fragment covers one topic. A **pack** is a recipe that selects several packages,
so a team can share a whole setup with one `add` command. Both live in ordinary
Git repositories.

## Day-to-day use

After changing `.agents/project.md`, run `render` and `check`.

To review and apply newer shared guidance:

```sh
npx @doomedramen/agents.md outdated
npx @doomedramen/agents.md diff --update
npx @doomedramen/agents.md update
npx @doomedramen/agents.md check
```

`outdated` checks whether your selected refs have moved. `diff --update` previews
the changes; `update` applies them. For sources pinned to a commit, choose a new
`ref` in `agents.yaml` before updating.

## Learn more

- [Usage guide](docs/usage.md): sources, local edits, exclusions, updates, CI,
  global guidance, and monorepos.
- [Create packages and packs](docs/authoring.md): publish reusable instructions
  for your own projects or team.
- [Public packages and working examples](https://github.com/doomedramen/agent-packages):
  inspect real source files and generated consumer projects.

## Development

```sh
npm install
npm run check
```

`npm install` installs Lefthook hooks. Pre-commit builds the CLI; pre-push runs the
full check. To inspect release contents, run `npm pack --dry-run --json` or
`npm publish --dry-run`. Publishing runs checks and rebuilds `dist/`; an actual
release requires an explicit maintainer action.
