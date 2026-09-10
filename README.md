# agents.md

`agents.md` composes reviewed, versioned `AGENTS.md` guidance from Git
repositories. It gives solo developers and teams the same workflow. It stores
standing rules and project context; task-specific skills remain separate and
are never installed or inferred.

Requirements: Node.js 20+ and Git.

## Personal project: public packages

Initialize a project, select public packages, add private local context, and
review upstream changes:

```sh
npx @doomedramen/agents.md init
npx @doomedramen/agents.md add github:doomedramen/agent-packages#packages/project-typescript --ref main
npx @doomedramen/agents.md edit
npx @doomedramen/agents.md diff --update
npx @doomedramen/agents.md update
npx @doomedramen/agents.md check
```

The package is public and reviewable in the
[`doomedramen/agent-packages`](https://github.com/doomedramen/agent-packages)
repository. Pin `main` only for a walkthrough; use a reviewed tag or commit
for a production configuration. A local source uses an explicit path, for
example `./examples/packages/typescript`; GitHub shorthand is not a local
path. The equivalent executable invocation is `agents.md ...`.

The default root output combines all selected fragments and
`.agents/project.md` into one `AGENTS.md`. `CLAUDE.md` is exactly
`@AGENTS.md\n`. Selecting Express, MySQL, TypeScript, and Prisma does not split
one backend into four files.

## Team project: shared conventions

Teams publish ordinary Git packages or a pack from a private repository and
review the consumer configuration and lockfile through Git:

```sh
agents.md init
agents.md add github:doomedramen/agent-packages#packs/typescript-project --ref main
agents.md edit
agents.md check
```

The public pack is a working baseline, not a hosted registry or special
service. Fork `agent-packages` or publish an ordinary Git repository when a
team needs its own reviewed rules. If CI must verify a convention, include the
required package or pack in committed `agents.yaml`; global guidance cannot
provide a repository guarantee.

## Monorepos

Use separate outputs only where native agent loading needs separate directory
guidance:

```sh
agents.md init
agents.md add github:doomedramen/agent-packages#packs/typescript-monorepo --ref main
agents.md check
```

This produces root and `apps/web` outputs. Root selections are not copied into
nested outputs by default. Native agent loading decides which files are
visible; agents.md does not claim universal precedence.

## Real public examples

The runnable source packages, pack recipes, and committed consumer fixtures
live in [`doomedramen/agent-packages`](https://github.com/doomedramen/agent-packages):

- [direct project example](https://github.com/doomedramen/agent-packages/tree/main/examples/direct-project)
- [TypeScript monorepo example](https://github.com/doomedramen/agent-packages/tree/main/examples/typescript-monorepo)
- [schema 2 packages](https://github.com/doomedramen/agent-packages/tree/main/packages)
- [schema 2 packs](https://github.com/doomedramen/agent-packages/tree/main/packs)

Each fixture commits its `agents.yaml`, `agents.lock`, generated instructions,
and local inputs. Run `agents.md check` from the fixture directory to verify
the committed state.

## Configuration

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

Packages provide fragments:

```yaml
schema: 2
name: typescript
description: TypeScript repository conventions
fragments:
  - id: boundaries
    source: boundaries.md
    title: Module boundaries
```

Use `exclude: [typescript/boundaries]` to remove one recommendation and put a
replacement in `.agents/project.md`. Pack exclusions use
`pack/member/fragment`. Exclusions must name real selected fragments.

Generated output has a stable notice and labelled sections. Markdown bodies keep
their content with CRLF normalized to LF. Commit `agents.yaml`, `agents.lock`,
generated instructions, and local inputs.

## Packs

A pack is a shareable Git recipe, not a skill bundle:

```yaml
version: 2
kind: pack
name: express-prisma-mysql
packages:
  - id: typescript
    source: ./packages/typescript
  - id: express
    source: ./packages/express
outputs:
  - directory: .
    use: [typescript, express]
    exclude: []
```

Relative members resolve from the recipe directory at its locked commit.
External members can specify refs. Nested packs, scripts, credentials, and
consumer local files are not allowed. Add a pack and a direct member together;
removing the pack preserves the direct contribution.

## Global guidance

Global scope uses one composition and separate personal `local.md`:

```sh
agents.md add github:doomedramen/agent-packages#packages/global-baseline --ref main --global --dry-run
agents.md add github:doomedramen/agent-packages#packages/global-baseline --ref main --global
agents.md edit --global
agents.md check --global
agents.md outdated --global
agents.md diff --update --global
agents.md update --global
```

`init --global --agents claude-code,codex` selects registered destinations.
Claude receives `AGENTS.md` plus exact `CLAUDE.md` import; Codex receives
`AGENTS.md`. Existing guidance must be explicitly adopted/reconciled first.
Tests can redirect home/config with `AGENTS_TEST_HOME` and
`AGENTS_CONFIG_DIR`.

## Drift and freshness

`check` detects changed local inputs, generated files, adapters, missing files,
and config/lock disagreement. It does not query moving remote refs. `outdated`
does query requested refs and returns 1 when commits changed. `diff --update`
previews current refs without consumer writes. `update` resolves and applies a
recoverable transaction.

## Authoring and licensing

Keep one fragment focused on one coherent convention. README files for example
packages state intended audience, assumptions, exclusions, and source license.
Use ordinary Git history to publish and review packages or packs; no account,
private index, hosted registry, or organization profile is required. Do not
copy task-specific skills into packages. Mention an existing skill only as
prose when useful.

## Migration

For a narrow schema 1 project, preview first:

```sh
agents.md migrate --dry-run
agents.md migrate
agents.md check
```

Multiple legacy owners, custom destinations, global state, mixed state, and
edited generated files require manual reconciliation. Migration never guesses
which overwritten legacy guidance a team intended to retain.

## Development

```sh
npm install
npm run check
npm pack --dry-run --json
npm publish --dry-run
```

`npm install` installs the Lefthook Git hooks. Pre-commit runs the build;
pre-push runs the full check. Publishing runs the full check through
`prepublishOnly`, and `prepack` rebuilds `dist/` immediately before the package
tarball is created. Publishing remains an explicit maintainer action.
