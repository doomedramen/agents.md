# Create packages and packs

A package lets several projects share instructions. A pack combines packages
into a reusable setup. Both are files in an ordinary Git repository.

For working examples, see the public
[agent-packages repository](https://github.com/doomedramen/agent-packages).

## Create a package

Make a directory containing a manifest, a README, and one or more Markdown files:

```text
typescript/
├── agent.yaml
├── README.md
└── conventions.md
```

The schema 2 manifest names the fragments to include:

```yaml
schema: 2
name: typescript
description: TypeScript repository conventions
fragments:
  - id: conventions
    source: conventions.md
    title: TypeScript conventions
```

Each fragment is ordinary Markdown. Keep it focused on one topic, such as a
library's usage patterns or a team's review conventions. It should make sense
in any project in its intended audience.

Keep project commands, private configuration, and service-specific facts in the
consumer's local notes. Do not include credentials, scripts, or task-specific
skills. A package README should explain its audience, assumptions, exclusions,
and source license.

## Try it in a project

From a consumer project, initialize and add the local package directory:

```sh
npx rulepacks init
npx rulepacks add ../shared-guidance/typescript
npx rulepacks check
```

Use `init --adopt` when the consumer already has an `AGENTS.md`. Inspect the
rendered instructions to check that the shared guidance and local context fit
together.

Commit the package to its Git repository, then publish it by pushing that commit.
Consumers can add the package using a Git source with a reviewed ref. Change any
local source selection to the published source before committing a configuration
that teammates need to reproduce.

## Create a pack

A pack recipe lives in `agents.yaml`. It selects packages and describes their
outputs:

```yaml
version: 2
kind: pack
name: backend
packages:
  - id: typescript
    source: ../../packages/typescript
  - id: express
    source: ../../packages/express
outputs:
  - directory: .
    use: [typescript, express]
    exclude: []
```

Relative sources resolve from the recipe directory at its locked Git commit.
The example assumes the recipe is in `packs/backend/` and the packages are in
`packages/` in the same repository. External members can specify their own refs.

A pack can define a root output or several directory outputs for a monorepo.
Project-specific local notes remain in the consumer. Packs cannot contain nested
packs, scripts, credentials, or consumer local files.

Add the pack from its published directory:

```sh
npx rulepacks add github:doomedramen/agent-packages#packs/typescript-project --ref main
```

The consumer lockfile records the recipe commit and each member commit
separately. Review the recipe and member guidance together when updating a pack.
