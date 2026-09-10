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
npx @doomedramen/agents.md add github:community/agent-rules#packages/typescript
npx @doomedramen/agents.md add github:community/agent-rules#packages/express
npx @doomedramen/agents.md edit
npx @doomedramen/agents.md diff --update
npx @doomedramen/agents.md update
npx @doomedramen/agents.md check
```

The repository names above are walkthrough placeholders: replace them with
Git sources you have reviewed. A local source uses an explicit path, for
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
agents.md add github:your-team/agent-rules#packs/default
agents.md edit
agents.md check
```

`your-team/agent-rules` is a placeholder, not a hosted service supplied by
this project. A company baseline is optional. If CI must verify it, include the
required package or pack in committed `agents.yaml`; global guidance cannot
provide a repository guarantee.

## Monorepos

Use separate outputs only where native agent loading needs separate directory
guidance:

```sh
agents.md init
agents.md add github:community/agent-rules#packages/turborepo
agents.md add github:community/agent-rules#packages/nextjs --dir apps/web
agents.md add github:community/agent-rules#packages/hono --dir apps/api
agents.md edit --dir apps/web
agents.md edit --dir apps/api
agents.md check
```

This produces root, `apps/web`, and `apps/api` outputs. Root selections are not
copied into nested outputs by default. Native agent loading decides which files
are visible; agents.md does not claim universal precedence.

## Configuration

```yaml
version: 2
packages:
  - id: typescript
    source: github:acme/agent-rules#packages/typescript
    ref: main
packs: []
outputs:
  - directory: .
    use: [typescript]
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
agents.md add github:your-team/agent-rules#packs/default --global --dry-run
agents.md add github:your-team/agent-rules#packs/default --global
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
```

No npm version bump or publish is part of this release.
