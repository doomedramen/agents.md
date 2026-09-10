# Agents

## Specification

Agents is a package manager and discovery system for AI coding-agent
instruction files.

It distributes files such as:

- `AGENTS.md`
- `CLAUDE.md`
- `.cursor/rules/*`
- `.github/copilot-instructions.md`
- `GEMINI.md`
- other current or future agent instruction/configuration files

It serves both project-local files committed with a repository and global
files loaded by an agent across projects.

The product is Git-native by design. GitHub and Git are used for both
package storage and registry indexing. Agents does not upload package
contents to a separate storage service and does not require a registry
database.

## 0. Architecture decision

This section is normative.

1. Agent package files and `agent.yaml` live in ordinary Git repositories.
   The source repository at a Git commit is the canonical package content.
2. The public registry is a Git repository, hosted on GitHub by default.
   Its files are the package index.
3. Registration, validation, metadata refresh, and generated search data run
   through Git commits, pull requests, and GitHub Actions.
4. The registry website, if provided, is a static site generated from the
   index repository and deployable with GitHub Pages.
5. No package-content object store, package upload service, SQL database,
   search SaaS, or always-on indexing backend is required.
6. The GitHub API may accelerate GitHub operations, but it is not the source
   of truth. Every registry result must be reproducible from an index Git
   checkout.
7. A project must remain usable when the Agents CLI or public index is
   unavailable. Committed instruction files and `agents.lock` provide this
   guarantee.
8. Package metadata, not CLI flags, declares whether each file belongs to
   project scope, global scope, or both. Agent-specific entrypoints are
   generated adapters over canonical content whenever the target supports it.

The term “registry” describes the discovery experience. Its durable state is
Git repositories.

## 1. Goals

Agents should make agent instruction files:

- reusable
- discoverable
- versioned
- reproducible
- easy to install
- easy to update
- easy to review
- usable privately within organisations
- usable at project and user-global scope
- independent of any particular coding agent
- naturally compatible with GitHub pull requests and normal Git workflows

The product should feel like a conventional developer package manager:

    Git repository
          |
          v
    Agent package
          |
          v
    npx agents.md add
          |
          v
    Project instruction files

## 2. Non-goals

The initial version does not attempt to:

- generate project-specific instructions with AI
- automatically rewrite or improve instruction files
- deeply merge arbitrary Markdown documents
- execute package installation scripts
- host package contents outside Git
- maintain a separate registry database
- provide an always-on indexing service
- replace agent-native configuration systems
- manage MCP servers, coding-agent binaries, or agent skills
- provide a general-purpose dotfiles manager

Agents installs and manages instruction files. Git remains the package
transport, history, review, and storage layer.

## 3. Terminology

### Agent package

An agent package is a directory containing `agent.yaml` and one or more
files intended to configure AI coding agents.

Example:

    nextjs/
    ├── agent.yaml
    ├── AGENTS.md
    ├── adapters/
    │   └── claude-code.md
    ├── .cursor/
    │   └── rules/
    │       └── nextjs.mdc
    └── .github/
        └── copilot-instructions.md

Packages are not restricted to a predefined list of filenames.

### Source repository

A source repository is the Git repository containing package content.

Example:

    https://github.com/acme/agent-files.git

### Index repository

An index repository is a Git repository containing small, reviewable index
entries. An entry points to a source repository and package path. It does not
contain a second copy of package files.

The default public index is configurable. The examples below use
`https://github.com/example/agents-index.git`.

### Registry

The registry is the discovery experience built from one or more index
repositories. It is not a separate content-hosting or database service.

### Project manifest

`agents.yaml` records package requests with project targets and enough source
information to install them without resolving the short name again. Global
targets use a separate user manifest. The package's `agent.yaml`, not either
consumer manifest, is authoritative for target scope.

### Lockfile

`agents.lock` records exact source commits, file hashes, ownership, and the
index commit used for project-scope resolution. Global scope uses a separate
global lockfile.

### Selector

A selector is a mutable request such as a branch, tag, or semver range.
Selectors are resolved to a full Git commit before installation.

### Scope

Agents has two installation scopes:

- `project`: files available inside one consuming repository
- `global`: files available across projects for one user and agent

Scope is declared by the package's `agent.yaml`. The CLI must not require a
scope flag to decide where a declared file belongs. A package that declares
both scopes updates both scope-specific state files; a package that needs
independent user choice should publish separate package entries.

### Agent target

An agent target is a logical destination identified by an agent, scope, and
path relative to that scope's root. Examples:

    project / AGENTS.md
    project / .cursor/rules/frontend.mdc
    global / codex / AGENTS.md
    global / claude-code / CLAUDE.md

The CLI resolves logical global targets through built-in, versioned adapters
to platform-specific directories. Package manifests never contain arbitrary
absolute home-directory paths.

## 4. Source-of-truth model

| Data | Canonical source | Purpose |
| --- | --- | --- |
| Package files and `agent.yaml` | Source Git repository at commit | Package content |
| Registered package pointer | Index Git repository | Discovery |
| Derived package metadata | Index entry, verified from source | Search and display |
| Requested project dependencies | `agents.yaml` | Project intent |
| Requested global dependencies | User global manifest | User intent |
| Resolved scope state | Scope-specific lockfile | Reproducible installation |
| Installed project files | Project working tree | Files consumed by agents |
| Installed global files | User/agent global directories | Files consumed across projects |
| Local Git/cache data | Disposable local cache | Performance only |

The source repository is authoritative for package content. The index may
cache metadata and the latest observed source commit, but must link to and
validate the source package. A stale index must never change the meaning of a
locked source commit.

## 5. Package format

Minimum package layout:

    repo/
    ├── agent.yaml
    ├── AGENTS.md
    └── README.md

Multi-package repositories are supported:

    repo/
    ├── packages/
    │   ├── base/
    │   │   ├── agent.yaml
    │   │   └── AGENTS.md
    │   └── nextjs/
    │       ├── agent.yaml
    │       └── AGENTS.md
    └── README.md

Suggested manifest:

    schema: 1
    name: nextjs
    description: Agent instructions for Next.js projects

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
      - source: .cursor/rules/nextjs.mdc
        targets:
          - scope: project
            agent: cursor
            path: .cursor/rules/nextjs.mdc
            mode: direct
      - source: .github/copilot-instructions.md
        targets:
          - scope: project
            agent: github-copilot
            path: .github/copilot-instructions.md
            mode: direct
      - source: adapters/claude-code.md
        targets:
          - scope: project
            agent: claude-code
            path: .claude/rules/nextjs.md
            mode: direct

    tags:
      - nextjs
      - react
      - typescript

    detect:
      packageJson:
        dependencies:
          - next

Optional metadata:

    homepage: https://github.com/acme/agent-files
    license: MIT
    authors:
      - Acme
    requires:
      agents: ">=1.0"
    conflicts:
      - legacy-nextjs

### Scope-aware files

The scalar `files` form is shorthand for project-scope files whose source
path and destination path are identical. Scope is package metadata, not a
CLI option. Packages that serve global and project installations use explicit
targets in `agent.yaml`:

    schema: 1
    name: base
    description: Shared coding-agent instructions

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
          - scope: global
            agent: codex
            path: AGENTS.md
            mode: direct
          - scope: global
            agent: claude-code
            path: AGENTS.md
            mode: direct
          - scope: global
            agent: claude-code
            path: CLAUDE.md
            mode: import
            import: AGENTS.md

Each target declares:

- `scope`: `project` or `global`
- `agent`: required for global targets; optional for shared project files
- `path`: relative path below the resolved scope root
- `mode`: `direct`, `import`, or `copy`; defaults to `direct`
- `import`: required for `import` mode; a relative path to the canonical
  content from the generated adapter file

The `canonical.source` field identifies shared content that adapters can
reuse. `direct` writes the source bytes to the target. `import` generates the
agent-native adapter file; its `import` path must also be declared as a
canonical target in the same scope and agent (a shared project target may
serve all project agents). `copy` materializes the same source bytes for
agents without a documented import mechanism. Every generated adapter and
canonical target is managed and recorded in the lockfile.

Do not use an ordinary Markdown hyperlink as an instruction-file adapter.
Agents are not required to follow links while loading configuration. Claude
Code documents native `@path/to/file` imports, so its adapter can contain
`@AGENTS.md`; Codex natively loads `AGENTS.md` and needs no adapter. See the
[Claude Code memory documentation](https://code.claude.com/docs/en/memory) and
[Codex AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
The first Claude Code adapter should generate this minimal file:

    @AGENTS.md

One source file may target both scopes. One package may provide different
files for different agents. `agents add` reads these declarations, places
project targets in project state and global targets in user-global state, and
installs every declared target. It must not accept a scope flag that changes
the package declaration. If independent scope choice is required, publish
separate package entries.

V1 keeps the schema small. Package manifests declare files and destinations;
they do not declare executable hooks.

## 6. Source repository rules

Supported source forms:

    npx agents.md add official/nextjs
    npx agents.md add @acme/agent-files
    npx agents.md add github:acme/agent-files#packages/nextjs
    npx agents.md add https://github.com/acme/agent-files.git#packages/nextjs
    npx agents.md add git@github.com:acme/agent-files.git#packages/nextjs
    npx agents.md add ../local-agent-files/nextjs

`@owner/repo` is an Agents GitHub shorthand. In this example:

    npx agents.md add @doomedramen/agents-nextjs

`npx` resolves only the `agents.md` CLI package; the CLI resolves
`@doomedramen/agents-nextjs` as a GitHub source and must never treat it as an
npm dependency. A source reference must unambiguously identify:

- Git repository URL
- package subdirectory, if any
- requested ref, if supplied

The source repository may be:

- a public GitHub repository
- a private GitHub repository
- an organisation-owned GitHub Enterprise repository
- another Git server reachable through Git
- a local directory during package development

GitHub is the default public host. Generic Git transport remains useful for
private and self-hosted installations.

Package discovery searches documented conventional locations only. It must
not recursively treat every `agent.yaml` in an arbitrary repository as a
package.

### Repository naming and folder structure

The [skills.sh CLI documentation](https://www.skills.sh/docs/cli) is a useful
reference for source naming and shallow repository discovery. It uses
`owner/repo` as the source identity, supports direct paths into a repository,
keeps machine-readable metadata beside each skill, and discovers content only
inside known container directories. Agents should follow the same shape while
keeping its own Git-native package contract.

Recommended source repository:

    agent-files/
    ├── README.md
    ├── LICENSE
    ├── agents/
    │   ├── base/
    │   │   ├── agent.yaml
    │   │   ├── AGENTS.md
    │   │   ├── adapters/
    │   │   │   └── claude-code.md
    │   │   └── README.md
    │   └── nextjs/
    │       ├── agent.yaml
    │       ├── AGENTS.md
    │       └── README.md
    └── .github/
        └── workflows/
            └── validate.yml

Naming rules:

- Use the GitHub `owner/repo` as the primary source identity.
- Use lowercase kebab-case for repository names, package directories, and
  package slugs.
- Give every package a short stable slug matching its directory where
  practical.
- Keep `agent.yaml` and the canonical `AGENTS.md` at package root. Scope is
  declared in `agent.yaml`, not encoded by duplicating the folder tree.
- Use an `adapters/` directory only for optional agent-specific additions;
  generated entrypoints such as `CLAUDE.md` do not belong in source control.
- Put human documentation in the source repository `README.md` and, when a
  repository contains multiple packages, in each package's `README.md`.
- Use `agents/` as the preferred package container. Accept `packages/` as
  an equivalent conventional container.
- Permit a root package or one/two category levels below a known container,
  such as `agents/nextjs/`, `agents/frontend/nextjs/`, or
  `packages/frontend/web/nextjs/`.
- Do not discover packages by default under `examples/`, `tests/`,
  `vendor/`, generated output, or arbitrary deep paths.

For GitHub sources, a stable display identifier should mirror the
`owner/repo/package-slug` convention used by skills.sh. The exact source
reference remains `github:owner/repo#package/path`, because the path is the
unambiguous identity for installation. A curated registry alias such as
`official/nextjs` may point to that source identifier but must not replace
its provenance.

The package manifest is the Agents equivalent of skills.sh's required
machine-readable metadata. It should require `schema`, `name`, and
`description`; `files` remains the authoritative installation list.

## 7. GitHub/Git storage model

### Package storage

Authors commit package files to source repositories and push them through
their normal Git workflow. Agents never converts a package into a hosted
tarball or copies its canonical contents into a registry store.

Package history, tags, releases, code review, permissions, and deletion
semantics therefore come from Git and the selected Git host.

### Index storage

The default public index is an ordinary GitHub repository. Its durable data
is a directory of small YAML files:

    agents-index/
    ├── schema.yaml
    ├── packages/
    │   ├── official/
    │   │   └── nextjs.yaml
    │   └── acme/
    │       └── backend.yaml
    ├── generated/
    │   └── packages.json
    └── .github/
        └── workflows/
            ├── validate-index.yml
            └── refresh-index.yml

An index entry contains a pointer, not package content:

    schema: 1
    id: official/nextjs

    source:
      type: git
      url: https://github.com/example/agent-files.git
      path: packages/nextjs
      manifest: agent.yaml
      defaultBranch: main

    metadata:
      name: nextjs
      description: Agent instructions for Next.js projects
      tags:
        - nextjs
        - react
        - typescript
      homepage: https://github.com/example/agent-files
      supports:
        agents:
          - claude-code
          - codex
        scopes:
          - project
          - global

    observed:
      sourceCommit: 0123456789abcdef0123456789abcdef01234567
      indexedAt: 2026-09-10T00:00:00Z

Rules:

- `id` is unique within one index.
- `source.url` and `source.path` identify the package.
- `metadata` is discovery data, not package content.
- `metadata.supports.agents` and `metadata.supports.scopes` are derived
  from package targets.
- `observed.sourceCommit` is advisory and must use a full Git SHA.
- A validator fetches the source package and checks that metadata and manifest
  agree before an entry is accepted.
- Every change to an entry is a normal Git commit, preferably reviewed in a
  pull request.
- The index may contain generated search artifacts, but those artifacts are
  derived from committed index entries and can always be rebuilt.

The index repository may be forked or mirrored. Organisations may maintain
private index repositories with the same format.

### What is deliberately absent

The architecture has no:

- package upload endpoint
- package blob store
- registry SQL database
- Elasticsearch/Algolia dependency
- hidden mutable version table
- installation-count database

Popularity signals may later be derived from GitHub repository metadata and
committed as non-authoritative snapshots. They are not required for package
resolution or safety.

## 8. Indexing workflow

Indexing is a GitHub/Git workflow:

    source repository change
              |
              v
    GitHub Action checks out source
              |
              v
    validate agent.yaml and declared paths
              |
              v
    update index entry and generated search data
              |
              v
    commit or open pull request in index repository
              |
              v
    merged index commit becomes discoverable state

### Registration

For a new package, a maintainer adds an index entry through a branch and pull
request. A future `agents publish` command may generate the entry and open
the pull request using the user's GitHub credentials.

Registration does not upload package files. It records the source Git URL and
package path.

### Validation

`validate-index.yml` must:

- parse the index schema
- validate package identifiers
- clone or fetch every public source package
- validate `agent.yaml`
- verify every declared file exists
- validate target scopes, agent identifiers, rendering modes, import paths,
  and relative destination paths
- verify that every `import` target names a declared canonical target in the
  same scope and agent, or a shared project target
- reject unsafe paths and symlink traversal
- reject duplicate or ambiguous entries
- check that derived metadata matches the source manifest

Private index repositories may validate private source repositories using
organisation-controlled GitHub Actions credentials.

### Refresh

`refresh-index.yml` may run on a schedule or manual dispatch. It fetches
registered sources, records new observed commits and derived metadata, and
opens a pull request when changes exist. Source repositories remain
authoritative; refresh only updates the discovery snapshot.

An always-on webhook service is not required. A source repository may
optionally dispatch the same workflow after a push.

### Search

The CLI clones or fetches the configured index repository into its local
cache, then searches committed entries locally. A generated
`generated/packages.json` file may make this faster, but it is still
versioned in Git.

GitHub APIs may be used as an optimisation for public repositories or pull
requests. The CLI must retain a Git checkout path, and search results must be
reproducible from an index commit.

## 9. Core user workflows

### Add package from the index

    mkdir my-app
    cd my-app
    npx agents.md add official/nextjs

Agents:

1. fetches the configured index Git repository
2. resolves the package entry
3. fetches the source repository
4. resolves the requested ref to a full commit
5. validates the package
6. detects collisions and local modifications
7. installs files
8. writes the relevant state files: `agents.yaml` for project targets and
   `global.yaml`/`global.lock` for global targets

### Add global instructions

Global state is separate from project state, but the package manifest decides
which state it uses:

    npx agents.md init
    npx agents.md add @acme/agent-standards
    npx agents.md install

If `agent.yaml` declares both project and global targets, `add` records the
same source in both `agents.yaml` and `global.yaml`, and `install` reconciles
both. A package that declares only global targets updates only `global.yaml`.
The CLI shows the global write plan and uses the configured target adapter;
there is no scope flag to override package metadata.

### Add package directly from Git

The public index is optional:

    npx agents.md add github:acme/agent-files#packages/nextjs
    npx agents.md add git@github.com:acme/agent-files.git

Existing Git authentication must be used. Agents does not create a separate
GitHub account or credential system.

### Restore a project

    git clone git@github.com:acme/shop.git
    cd shop
    npx agents.md install

`agents install` prefers commits in `agents.lock`. It does not need the
public index when the manifest and lockfile contain explicit source
references.

For global state:

    npx agents.md install

This reads project state and the user's global manifest/lockfile, then
resolves each declared logical target to the appropriate directory.

### Update packages

    npx agents.md outdated
    npx agents.md diff
    npx agents.md update

Updates produce ordinary working-tree changes suitable for a normal pull
request. Unsafe local modifications stop the update.

### Remove a package

    npx agents.md remove official/nextjs

Agents removes only files owned exclusively by the package, after checking
for local changes. It updates every state file covered by the package's
declared targets. A package installed in both scopes is removed from both by
one command.

## 10. CLI

The CLI is distributed as the npm package `agents.md`. Its primary
invocation is:

    npx agents.md <command> [arguments]

The package exposes an `agents.md` executable through npm's `bin` field. A
local project may install it as a dev dependency for faster repeat use, but
the package is only the CLI distribution; package files and index data remain
in Git repositories.

Initial commands:

    npx agents.md init
    npx agents.md add
    npx agents.md install
    npx agents.md remove
    npx agents.md update
    npx agents.md outdated
    npx agents.md diff
    npx agents.md list
    npx agents.md targets
    npx agents.md search
    npx agents.md info
    npx agents.md check

Potential later commands:

    npx agents.md publish
    npx agents.md validate
    npx agents.md doctor
    npx agents.md trust
    npx agents.md pin
    npx agents.md clean

Scope is not a CLI selection. The installed package's `agent.yaml` declares
the scope and agent for every target. `agents add` and `agents install` route
project targets to the consuming repository and global targets to the
appropriate user-global adapter. A package that declares both scopes updates
both state files. There is no `--scope` or `--global` target-selection flag.

### `agents targets`

Shows supported agent adapters and their resolved project/global roots. This
is the diagnostic command for confirming where package-declared targets will
write files:

    npx agents.md targets
    npx agents.md targets --agent codex

### `agents init`

Creates project state:

    agents.yaml
    agents.lock

When a package declares global targets, the CLI creates user state lazily in
the platform-specific Agents configuration directory:

    global.yaml
    global.lock

Project detection may suggest packages, but must not install anything
silently.

### `agents add`

Examples:

    npx agents.md add official/nextjs
    npx agents.md add acme/agents#packages/base
    npx agents.md add https://github.com/acme/agents.git#packages/base
    npx agents.md add ./agent-packages/base
    npx agents.md add official/nextjs --dry-run
    npx agents.md add @acme/agent-standards

The command resolves, validates, plans, and installs package files. It must
show conflicts before writing files. It writes each target according to the
scope and agent declared in the package's `agent.yaml`.

### `agents install`

Reads project `agents.yaml`/`agents.lock` and user-global
`global.yaml`/`global.lock`, fetches locked Git commits, and restores every
declared target. If a lockfile does not exist, it resolves selectors and
creates the relevant lockfile. There is no scope-selection flag.

### `agents update`

Checks source Git refs for newer commits or tags, displays the proposed file
changes, and updates the lockfile after a safe install.

Useful options:

    npx agents.md update --dry-run
    npx agents.md update --interactive
    npx agents.md update official/nextjs --force

`--force` is an explicit destructive choice and must clearly warn that local
changes may be overwritten.

### `agents diff`

Shows differences between installed files and package files at the locked or
incoming source commit:

    npx agents.md diff
    npx agents.md diff official/nextjs

### `agents check`

Checks that:

- each relevant lockfile matches its manifest
- locked package commits are available and valid
- installed files match lockfile hashes
- no managed file is unexpectedly missing
- package ownership is unambiguous

    npx agents.md check --frozen

## 11. Project manifest

Suggested `agents.yaml`:

    version: 1

    indexes:
      - https://github.com/example/agents-index.git

    packages:
      - id: official/nextjs
        source:
          type: git
          url: https://github.com/example/agent-files.git
          path: packages/nextjs
        selector: main

      - id: acme/base
        source:
          type: git
          url: git@github.com:acme/agent-standards.git
          path: base
        selector: v2.1.0

The source descriptor is written into the manifest after index resolution.
This makes future installation independent of a live registry.

Short references are allowed as CLI input. The on-disk manifest should favour
explicit Git source information. Scope and target agents are not user
selectors in this file; they are derived from the package's `agent.yaml`.
When that manifest declares global targets, the same dependency is recorded in
the user-global manifest:

    <agents-config-dir>/global.yaml:

        version: 1

        packages:
          - id: acme/base
            source:
              type: git
              url: git@github.com:acme/agent-standards.git
              path: base
            selector: v2.1.0

The CLI reads the package manifest at the locked commit, partitions its
targets by declared scope, and installs every compatible target. Unknown or
unavailable agent adapters must produce a clear error, not a write to a
guessed path.

Project state and global state use separate manifests. The default global
manifest is `global.yaml` in the platform-specific Agents configuration
directory. A user may place that directory in a Git-managed dotfiles
repository.

## 12. Lockfile

`agents.lock` is the deterministic project lockfile and is suitable for
committing to Git. `global.lock` has the same format for user-global state
and is stored beside `global.yaml`.

    version: 1

    index:
      url: https://github.com/example/agents-index.git
      commit: 0123456789abcdef0123456789abcdef01234567

    packages:
      official/nextjs:
        scope: project
        source:
          type: git
          url: https://github.com/example/agent-files.git
          path: packages/nextjs
        requested: main
        commit: 89abcdef0123456789abcdef0123456789abcdef
        manifestSha256: sha256:...
        files:
          - scope: project
            path: AGENTS.md
            mode: direct
            sha256: sha256:...
          - scope: project
            agent: claude-code
            path: CLAUDE.md
            mode: import
            import: AGENTS.md
            sha256: sha256:...
          - scope: project
            path: .cursor/rules/nextjs.mdc
            mode: direct
            sha256: sha256:...

Global lock (`global.lock`) uses the same schema:

    version: 1

    index:
      url: https://github.com/example/agents-index.git
      commit: 0123456789abcdef0123456789abcdef01234567

    packages:
      acme/base:
        scope: global
        source:
          type: git
          url: git@github.com:acme/agent-standards.git
          path: base
        requested: v2.1.0
        commit: 0123456789abcdef0123456789abcdef01234567
        manifestSha256: sha256:...
        files:
          - scope: global
            agent: codex
            path: AGENTS.md
            mode: direct
            sha256: sha256:...
          - scope: global
            agent: claude-code
            path: AGENTS.md
            mode: direct
            sha256: sha256:...
          - scope: global
            agent: claude-code
            path: CLAUDE.md
            mode: import
            import: AGENTS.md
            sha256: sha256:...

The full Git commit is the primary immutable package version. Tags and
releases are human-friendly selectors that must resolve to commits.

The index commit is recorded when an index resolved a short package name. It
is not needed to install an already explicit source and locked commit. Lock
entries store logical target paths and adapter identifiers, never absolute
home-directory paths. Scope, agent, mode, and import fields in a lockfile are
snapshots of the package manifest at the locked commit; they are not
alternate user-controlled scope selectors.

## 13. Resolution, cache, and transactions

High-level install algorithm:

    read agents.yaml and agents.lock
          |
          v
    fetch source repository into Git cache
          |
          v
    resolve or verify full commit
          |
          v
    read agent.yaml at that commit
          |
          v
    read package-declared project/global targets and agent adapters
          |
          v
    validate paths and package files
          |
          v
    calculate writes, removals, and conflicts
          |
          v
    check local modifications
          |
          v
    stage complete operation
          |
          v
    write files, manifest, and lockfile

Project writes are relative to the consuming repository root. Global writes
are relative to a built-in or explicitly configured agent target root. The
package declares the scope and logical target; the package cannot choose the
physical root.

The operation should be transactional where practical. A failed install must
not leave half a package installed.

Repositories and index checkouts may be cached in the platform-specific
cache directory, for example:

    ~/.cache/agents/

The cache is disposable. It is not package storage and must never be required
for project correctness.

## 14. File ownership and conflicts

The lockfile records every managed target and its owning package. Ownership
key is the selected scope, agent target, and relative destination path.

Project and global files with the same filename are different targets and do
not conflict:

    project / CLAUDE.md
    global / claude-code / CLAUDE.md

V1 rejects ambiguous ownership within the same target.

Example conflict:

    Conflict:

    acme/base
      CLAUDE.md

    community/nextjs
      CLAUDE.md

Both packages install the same path.

Agents must stop rather than silently overwrite. Future versions may support
explicit precedence, fragments, composition, or generated aggregate files.
Agent-native precedence between global and project files remains the
responsibility of the target agent; Agents does not merge those files.

When removing a package:

- remove files owned only by that package
- preserve files shared by another package if sharing is later supported
- stop when a file has local changes

## 15. Local modifications and updates

For each managed target, Agents compares:

- the previous package hash
- the current installed file hash
- the incoming package hash

The target record includes scope, agent, and relative destination path. The
same protection applies to files in global agent directories.

Required behavior:

    unchanged locally, changed upstream
      safe update

    changed locally, unchanged upstream
      preserve local file and report drift

    changed locally, changed upstream
      stop and require review or explicit force

V1 may block unsafe replacement rather than attempt a Markdown merge.

Example error:

    Cannot update CLAUDE.md.

    The file has changed locally since installation.

    Review:
      npx agents.md diff official/nextjs

    Overwrite explicitly:
      npx agents.md update official/nextjs --force

## 16. Security and path safety

Agent instructions are potentially dangerous content. Coding agents may
interpret them as permission to execute commands, modify files, access
credentials, make network requests, or delete data.

Installation therefore:

- executes no package lifecycle scripts
- treats all package files as reviewable content
- locks dependencies to Git commits
- displays source URLs and package paths
- validates every target before writing
- rejects paths escaping the active scope root
- rejects package-supplied absolute paths
- rejects `..` traversal
- rejects platform-specific absolute paths such as `C:\Users\...`
- inspects symlinks to prevent traversal
- rejects duplicate file declarations
- rejects unsupported manifest schemas
- stages writes before committing them

For project scope, the active scope root is the consuming repository. For
global scope, it is the selected agent's registered global root. A package
cannot choose an arbitrary global root or write to another user's files.

Global writes are permitted only when the locked package manifest declares a
global target. The CLI must show those writes in its plan, require normal
confirmation for a new global target unless configured otherwise, and use the
same local-modification protection as project writes. A CLI flag must not
override the package-declared scope.

The index validator applies the same package validation before accepting an
entry.

## 17. GitHub authentication

The CLI requires no Agents account for:

- installing public packages
- searching a public index
- reading public GitHub repositories
- using direct Git URLs
- using private repositories already accessible to the developer

GitHub and Git authentication use existing local mechanisms:

- SSH keys and Git credential helpers
- GitHub CLI authentication where available
- GitHub Enterprise configuration
- standard Git environment/configuration

Agents must not store a second copy of GitHub credentials.

Publishing or opening an index pull request may use the user's existing
`gh` authentication, but regular installation remains independent of it.

## 18. Versioning

Git commits are canonical immutable package versions.

Authors may use tags:

    v1.0.0
    v1.1.0
    v2.0.0

Examples:

    npx agents.md add official/nextjs@v1.4.0
    npx agents.md add official/nextjs@main

Both resolve to a full commit in `agents.lock`. Semver range resolution may
be added later; it must always end at an immutable commit.

## 19. Index website and discovery

The website is optional for the first CLI prototype.

If provided, it should be a static site built from the index repository and
deployed with GitHub Pages or equivalent static hosting. It may show:

- package search
- package identifiers
- descriptions and tags
- source repository links
- package paths
- file names derived from `agent.yaml`
- source previews linked to GitHub
- latest observed source commit
- supported coding agents inferred from files
- supported scopes: project, global, or both
- GitHub-derived stars or contributors as optional signals

The site must not become a second package store. Package content remains in
source Git repositories.

Search and package pages should work from the committed index data. A custom
HTTP API is not part of the core architecture.

## 20. Private and organisation use

Private organisations can use the CLI without the public index:

    npx agents.md add git@github.com:my-company/agent-standards.git#base

They may also maintain a private index repository:

    indexes:
      - git@github.com:my-company/private-agents-index.git

Private index entries, source repositories, and GitHub Actions can use
organisation permissions. No central Agents account is required.

Future organisation features may include:

- approved package policies
- mandatory packages
- private index mirrors
- deprecation and advisories
- verified maintainers
- automated update pull requests

## 21. Project detection

Detection is advisory. It must not install packages or modify files without
an explicit command.

Examples:

JavaScript:

- `package.json`
- `pnpm-lock.yaml`
- `yarn.lock`
- `package-lock.json`

Rust:

- `Cargo.toml`

Python:

- `pyproject.toml`
- `requirements.txt`
- `uv.lock`

Possible recommendations:

    This project appears to use:

    Next.js
    TypeScript
    Prisma
    Playwright

    Recommended:
      npx agents.md add official/nextjs official/typescript official/prisma official/playwright

## 22. Git and CI integration

Installed instruction files should normally be committed to Git. Do not add
these to `.gitignore`:

    AGENTS.md
    CLAUDE.md
    agents.yaml
    agents.lock

This provides:

- agent access without running Agents first
- reviewable pull-request changes
- reproducible CI behavior
- self-contained repositories
- recovery if the CLI or public index disappears

Global instruction files should also be committed where practical, typically
through the user's Git-managed dotfiles repository. Agents materializes them
at native global agent paths but keeps package provenance and update state in
`global.yaml` and `global.lock`; it does not rely on a hidden central copy.

An organisation can automate updates by:

1. detecting a new source commit
2. resolving and validating it
3. generating ordinary file changes
4. opening a pull request
5. letting the team review and merge

## 23. Implementation architecture

    CLI
     |
     +-- Git transport and repository cache
     +-- Index client
     |    +-- Git fetch/checkout
     |    +-- local search
     |    +-- entry validation
     |
     +-- Resolver
     +-- Package parser and validator
     +-- Dependency/manifest manager
     +-- Scope and agent-target adapters
     +-- Installer and transaction planner
     +-- Lockfile manager
     +-- Ownership and collision checker
     +-- Diff engine
     +-- Project detector

External GitHub components:

    source GitHub repositories
             |
             v
    index GitHub repository
             |
             +-- GitHub Actions validation/refresh
             +-- optional generated static data
             +-- optional GitHub Pages site

There is no required registry backend between the CLI and Git repositories.

## 24. Language and portability

The CLI is written in TypeScript and published to npm as `agents.md`.

The package must:

- compile TypeScript to portable JavaScript
- expose an `agents.md` executable through `package.json.bin`
- support the current Node.js LTS runtime policy
- use the user's existing Git executable and credentials, or a compatible
  Git library where that improves portability
- keep package files and index data in Git; npm distributes only the CLI

The canonical invocation is:

    npx agents.md add @doomedramen/agents-nextjs

The `@owner/repo` argument is parsed by the CLI as a GitHub source shorthand;
it is not an npm package dependency. A local installation may invoke the same
binary as `agents.md` without `npx`.

Minimum npm package metadata:

    {
      "name": "agents.md",
      "type": "module",
      "bin": {
        "agents.md": "dist/cli.js"
      }
    }

The CLI should support:

- Linux
- macOS
- Windows

The index workflows and optional website are independent of CLI language.

## 25. Configuration

Project files:

    agents.yaml
    agents.lock

Global Agents state:

    <agents-config-dir>/global.yaml
    <agents-config-dir>/global.lock

Global configuration:

    <agents-config-dir>/config.toml

Example:

    default_index = "https://github.com/example/agents-index.git"

    [git]
    github_shorthand = true

### Target adapter contract

Each supported agent has an adapter with:

- stable agent identifier, such as `claude-code`, `codex`, `cursor`, or
  `github-copilot`
- project target rules
- global root resolution for Linux, macOS, and Windows
- supported global instruction/configuration paths
- supported native import syntax and adapter rendering modes
- agent-native precedence information
- adapter schema/version

Adapters resolve logical package targets to actual paths. For example, a
package can declare `global / codex / AGENTS.md` without knowing the user's
home directory or operating system. Adapter changes must be versioned and
recorded in the relevant lockfile.

The CLI ships target adapters for supported agents, including Claude Code,
Codex, Cursor, GitHub Copilot, and Gemini CLI. Each adapter defines the
platform-specific project and global roots expected by that agent. Adapter
names and logical paths are stable; physical home-directory paths are
resolved at runtime.

Users may configure additional adapters or override a root:

    [targets.my-agent]
    project_root = ".my-agent"
    global_root = "~/.my-agent"

Package manifests may select logical targets but may not supply arbitrary
absolute destination roots. Adapter identity/version should be recorded in
global lockfiles when it affects a resolved path.

Users should be able to configure multiple public or private index
repositories. Index precedence and duplicate IDs must be explicit and
deterministic.

## 26. MVP

The first usable version must support:

### Package format

- `agent.yaml`
- arbitrary declared files

### Git sources

- GitHub repositories
- generic Git URLs
- local directories
- private repositories through existing Git credentials

### Project state

- `agents.yaml`
- `agents.lock`
- separate global manifest and lockfile

### Commands

    npx agents.md init
    npx agents.md add
    npx agents.md install
    npx agents.md remove
    npx agents.md list
    npx agents.md targets
    npx agents.md diff
    npx agents.md update

### Required behavior

- full Git commit locking
- explicit source URL and package path
- file ownership
- collision detection
- local modification protection
- safe path validation
- project and global installation scopes
- target adapters for supported agents
- global writes only from package-declared global targets
- separate ownership and lock state per scope
- no package scripts
- transactional installation where practical
- operation without the public index after resolution

The MVP does not require a public website, hosted API, or central registry
database.

## 27. Phase 2

Add:

- a public GitHub index repository
- index entry validation workflows
- scheduled source refresh
- `agents search`
- `agents info`
- static GitHub Pages discovery site
- project/framework detection
- `agents outdated`
- `agents check`
- multiple organisation-owned indexes

## 28. Future functionality

Potential later features:

- package composition and instruction fragments
- three-way file merges
- semver range resolution
- signed Git commits or package attestations
- verified publishers
- security advisories stored in Git
- registry mirrors and index federation
- recommended package stacks
- IDE integrations
- GitHub Actions and Renovate-style update pull requests
- content search across source repositories where GitHub permissions allow it

All durable registry data should continue to have a Git representation.

## 29. Acceptance milestone

The first milestone is complete when this works:

    git init demo
    cd demo

    npx agents.md init
    npx agents.md add github:example/agent-packages#nextjs

and produces:

    agents.yaml
    agents.lock
    AGENTS.md
    CLAUDE.md

`CLAUDE.md` is a generated native import adapter containing `@AGENTS.md`,
not a second hand-maintained copy of the instructions.

On another machine:

    git clone demo
    cd demo
    npx agents.md install

must reproduce the same managed files from the locked Git commit, without
requiring the public index.

The following must also work:

    npx agents.md diff
    npx agents.md update
    npx agents.md remove official/nextjs

without silently overwriting or deleting locally modified files.

Global installation must also work independently:

    npx agents.md init
    npx agents.md add github:example/agent-packages#base
    npx agents.md install

When that package's `agent.yaml` declares only a Codex global target, this
must write only to the configured Codex global target, record the resolved
source commit in `global.lock`, and leave project files and `agents.lock`
unchanged. A later update or removal must protect locally modified global
files.

The public discovery path must additionally work from Git alone:

1. a package source repository contains a valid package
2. an index pull request adds a pointer entry
3. GitHub Actions validates the entry
4. the merged index commit exposes the package to `agents search`
5. `agents add` fetches package files from the source Git commit

## 30. Product positioning

Short description:

> Agents is a Git-native package manager for AI coding-agent instructions.

Expanded description:

> Install, share, version, and sync `AGENTS.md`, generated `CLAUDE.md` import
> adapters, Cursor rules, Copilot instructions, and other coding-agent
> configuration directly from Git repositories with `npx agents.md`.

The conceptual comparison is:

> Skills registries distribute capabilities. Agents distributes the
> instructions that tell coding agents how to work inside repositories.

## 31. Design principles

1. Git is the source of truth for package content.
2. GitHub/Git is the source of truth for registry indexing.
3. Installed instructions remain visible in the consuming repository.
4. Project and global scopes are first-class and separately managed.
5. Global writes are explicit, target-aware, and platform-safe.
6. Any declared file format can be managed.
7. No arbitrary package code is executed.
8. Updates are ordinary, inspectable Git changes.
9. Package versions are reproducible full Git commits.
10. Private Git repositories work naturally.
11. Canonical instructions are stored once; agent-specific entrypoints are
    generated from them when native imports exist.
12. npm distributes the TypeScript CLI only; Git stores packages and indexes.
11. The public index is optional infrastructure.
12. Index metadata never replaces source package content.
13. The system is agent-neutral.
14. Simple file installation comes before clever composition.
15. Local changes are never silently destroyed.
16. A project remains usable if Agents or its public index disappears.
17. Every durable registry state has a reviewable Git representation.
