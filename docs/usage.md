# Usage guide

Start with the [README quick start](../README.md#get-started). This guide covers
common changes after your first setup.

Every command below uses `npx rulepacks`. If you have installed the
CLI, the equivalent command is `rulepacks`.

## Add shared instructions

A source identifies a Git repository and the directory containing a package or
pack. `--ref` selects a branch, tag, or commit.

```sh
npx rulepacks add github:doomedramen/agent-packages#packages/project-typescript --ref main
```

For a team setup containing several packages, add a pack:

```sh
npx rulepacks add github:doomedramen/agent-packages#packs/typescript-project --ref main
```

Local sources use explicit paths, which are useful while authoring a package:

```sh
npx rulepacks add ./shared-guidance/typescript
```

Review a source's Markdown before adding it. Private Git sources use your
existing Git access; you do not need an rulepacks account or registry.

## Keep project facts local

Put commands, directory names, service boundaries, and project-specific rules in
`.agents/project.md`. Shared sources should contain guidance useful to other
projects using the same library or conventions.

You can edit this file directly, then run:

```sh
npx rulepacks render
npx rulepacks check
```

Or run `npx rulepacks edit`. It opens the local notes using `VISUAL`
or `EDITOR` and renders when the editor exits. Without either variable, it prints
the file path and tells you to render after editing.

If you already have instructions, initialize with `init --adopt`. The original
`AGENTS.md` is preserved in `.agents/adopted/AGENTS.md`, and its contents become
`.agents/project.md`. Review those notes before adding shared packages to avoid
duplicating rules.

## Choose which fragments to include

`agents.yaml` controls the composition. A typical project looks like this:

```yaml
version: 2
packages:
  - id: project-typescript
    source: github:doomedramen/agent-packages#packages/project-typescript
    ref: main
packs: []
outputs:
  - directory: .
    use: [project-typescript]
    exclude: []
    local: [.agents/project.md]
    adapters: [claude-code]
```

`use` selects packages or packs for an output. `local` lists local Markdown files
whose contents are included in that output. By default, selected fragments and
local notes are combined into one root `AGENTS.md`.

To omit a fragment, add its qualified ID to `exclude`. For example, the public
TypeScript package has a `validation-and-boundaries` fragment:

```yaml
exclude: [project-typescript/validation-and-boundaries]
```

Add replacement guidance to `.agents/project.md` if needed. Pack fragments use
`pack-id/member-id/fragment-id`. IDs must name fragments that are actually
selected; inspect the generated section headings or source manifest to find them.

After changing exclusions or local files, run `render` and `check`. After changing
source selections or refs, run `update` and `check`.

## Review updates

These commands answer different questions:

| Command | What it does |
| --- | --- |
| `check` | Verifies configuration, lockfile, local inputs, and generated files agree |
| `outdated` | Queries selected refs to find newer source commits |
| `diff` | Previews output from the locked sources and current local inputs |
| `diff --update` | Previews output using the current selected refs |
| `render` | Rebuilds from locked sources and current local inputs |
| `update` | Resolves selected refs and applies the new lockfile and output |

`check` does not query whether remote branches have moved. `outdated` returns
exit code 1 when sources changed. A preview does not change consumer files.

Use the normal review sequence:

```sh
npx rulepacks outdated
npx rulepacks diff --update
npx rulepacks update
npx rulepacks check
```

To update one selection, run `update <id>`. If its ref is pinned to a commit,
first change that ref to the reviewed new commit in `agents.yaml`.

To remove a selection, run `remove <id>`. Removing a pack preserves packages
that you also selected directly.

## Verify in CI

Commit `agents.yaml`, `agents.lock`, generated instructions, and configured local
Markdown files. Run the following from the consumer project in CI:

```sh
npx rulepacks check
```

This catches changes made to generated files or inputs without rebuilding. It
verifies the instruction files, not whether an agent followed their rules.
Required team guidance belongs in the committed project configuration; personal
global guidance cannot guarantee what another machine receives.

`render --offline` and `check --offline` use cached source data. Populate the
cache beforehand; an unavailable source still fails the command.

## Global guidance

For personal rules that apply across projects, initialize global scope and
choose the supported agents:

```sh
npx rulepacks init --global --agents claude-code,codex
npx rulepacks add github:doomedramen/agent-packages#packages/global-baseline --ref main --global
npx rulepacks edit --global
npx rulepacks check --global
```

Global scope has its own configuration, lockfile, and `local.md`. Use `--global`
with subsequent commands, including `outdated`, `diff --update`, and `update`.
Existing global guidance requires explicit adoption and reconciliation.

Claude Code receives an `AGENTS.md` and a `CLAUDE.md` containing `@AGENTS.md`.
Codex receives an `AGENTS.md`. The agent's own loading rules determine which
project and global instructions apply.

## Monorepos

Use multiple outputs when different directories need different guidance. The
public monorepo pack provides an example:

```sh
npx rulepacks add github:doomedramen/agent-packages#packs/typescript-monorepo --ref main
npx rulepacks check
```

It writes root guidance and separate `apps/web/AGENTS.md` guidance. Local notes
stay beside each output. Root selections are not automatically copied into the
nested output; the coding agent's native loading behavior determines visibility.
Use `edit --dir apps/web` to edit that output's local notes.

## Migrate older configurations

For a supported schema 1 project, preview the migration first:

```sh
npx rulepacks migrate --dry-run
npx rulepacks migrate
npx rulepacks check
```

Global legacy state, multiple legacy owners, custom destinations, mixed state,
or edits to generated files may require manual reconciliation. Migration does
not guess which overwritten instructions should be retained.

Run `npx rulepacks --help` for the command list, or append `--help`
to a command to see its supported options. `init`, `add`, `remove`, and `update`
support `--dry-run` for previewing those operations.
