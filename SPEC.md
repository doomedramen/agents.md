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
    agents add
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
    ├── CLAUDE.md
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

`agents.yaml` declares project-scope packages and records enough source
information to install them without resolving the short name again. Global
scope uses a separate user manifest.

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

Project scope is the default. Global scope always requires an explicit
selection.

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
    └── CLAUDE.md

Multi-package repositories are supported:

    repo/
    ├── packages/
    │   ├── base/
    │   │   ├── agent.yaml
    │   │   └── AGENTS.md
    │   └── nextjs/
    │       ├── agent.yaml
    │       └── CLAUDE.md
    └── README.md

Suggested manifest:

    schema: 1
    name: nextjs
    description: Agent instructions for Next.js projects

    files:
      - AGENTS.md
      - CLAUDE.md
      - .cursor/rules/nextjs.mdc
      - .github/copilot-instructions.md

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
path and destination path are identical. Packages that serve global and
project installations use explicit targets:

    schema: 1
    name: base
    description: Shared coding-agent instructions

    files:
      - source: project/AGENTS.md
        targets:
          - scope: project
            path: AGENTS.md

      - source: global/codex/AGENTS.md
        targets:
          - scope: global
            agent: codex
            path: AGENTS.md

      - source: global/claude/CLAUDE.md
        targets:
          - scope: global
            agent: claude-code
            path: CLAUDE.md

Each target declares:

- `scope`: `project` or `global`
- `agent`: required for global targets; optional for shared project files
- `path`: relative path below the resolved scope root

One source file may target both scopes. One package may provide different
files for different agents. A global install selects only global targets; it
must never copy project files into a user's home directory.

V1 keeps the schema small. Package manifests declare files and destinations;
they do not declare executable hooks.

## 6. Source repository rules

Supported source forms:

    agents add official/nextjs
    agents add github:acme/agent-files#packages/nextjs
    agents add https://github.com/acme/agent-files.git#packages/nextjs
    agents add git@github.com:acme/agent-files.git#packages/nextjs
    agents add ../local-agent-files/nextjs

The exact shorthand grammar may be refined during CLI implementation. A
source reference must unambiguously identify:

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
    │   │   ├── project/
    │   │   │   └── AGENTS.md
    │   │   ├── global/
    │   │   │   ├── claude/
    │   │   │   │   └── CLAUDE.md
    │   │   │   └── codex/
    │   │   │       └── AGENTS.md
    │   │   └── README.md
    │   └── nextjs/
    │       ├── agent.yaml
    │       ├── project/
    │       │   ├── AGENTS.md
    │       │   └── CLAUDE.md
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
- Keep `agent.yaml` at package root beside the scope directories.
- Use `project/` and `global/<agent>/` when a package serves both scopes.
  Flat project files remain valid for project-only packages.
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
- validate target scopes, agent identifiers, and relative destination paths
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
    agents add official/nextjs

Agents:

1. fetches the configured index Git repository
2. resolves the package entry
3. fetches the source repository
4. resolves the requested ref to a full commit
5. validates the package
6. detects collisions and local modifications
7. installs files
8. writes `agents.yaml` and `agents.lock`

### Add global instructions

Global state is separate from project state:

    agents init --global
    agents add acme/base --scope global --agent codex --agent claude-code
    agents install --scope global

The same package may be installed to both scopes:

    agents add acme/base --scope project
    agents add acme/base --scope global --agent codex

No command without an explicit global scope may write to user-level agent
directories. Global package state is user-specific and must not be inferred
from a project's `agents.yaml`.

### Add package directly from Git

The public index is optional:

    agents add github:acme/agent-files#packages/nextjs
    agents add git@github.com:acme/agent-files.git

Existing Git authentication must be used. Agents does not create a separate
GitHub account or credential system.

### Restore a project

    git clone git@github.com:acme/shop.git
    cd shop
    agents install

`agents install` prefers commits in `agents.lock`. It does not need the
public index when the manifest and lockfile contain explicit source
references.

For global state:

    agents install --scope global

This reads the user's global manifest and global lockfile, then resolves each
logical target to the appropriate agent-specific directory.

### Update packages

    agents outdated
    agents diff
    agents update

Updates produce ordinary working-tree changes suitable for a normal pull
request. Unsafe local modifications stop the update.

### Remove a package

    agents remove official/nextjs

Agents removes only files owned exclusively by the package, after checking
for local changes. It updates the state file for the selected scope. Example:

    agents remove acme/base --scope global

## 10. CLI

Initial commands:

    agents init
    agents add
    agents install
    agents remove
    agents update
    agents outdated
    agents diff
    agents list
    agents targets
    agents search
    agents info
    agents check

Potential later commands:

    agents publish
    agents validate
    agents doctor
    agents trust
    agents pin
    agents clean

Scope options:

    --scope project
    --scope global
    --global              # shorthand for --scope global

`--scope` may be repeated when one package should be installed in both
scopes; each scope still updates its own manifest and lockfile. The default
scope is `project`. Agent filters such as `--agent codex --agent
claude-code` apply to global targets.

### `agents targets`

Shows supported agent adapters and their resolved project/global roots. This
is the diagnostic command for confirming where a package will write files:

    agents targets
    agents targets --agent codex
    agents targets --scope global

### `agents init`

Without a scope flag, creates project state:

    agents.yaml
    agents.lock

With `--global`, creates user state in the platform-specific Agents
configuration directory:

    global.yaml
    global.lock

Project detection may suggest packages, but must not install anything
silently.

### `agents add`

Examples:

    agents add official/nextjs
    agents add acme/agents#packages/base
    agents add https://github.com/acme/agents.git#packages/base
    agents add ./agent-packages/base
    agents add official/nextjs --dry-run
    agents add acme/base --scope global --agent codex
    agents add acme/base --scope global --agent claude-code --agent codex

The command resolves, validates, plans, and installs package files. It must
show conflicts before writing files. Global scope installs only package
targets declared for the selected agents.

### `agents install`

For project scope, reads `agents.yaml` and `agents.lock`, fetches locked
Git commits, and restores project targets. If no lockfile exists, it resolves
selectors and creates one.

For global scope, reads `global.yaml` and `global.lock`, then restores only
global targets:

    agents install --scope global

### `agents update`

Checks source Git refs for newer commits or tags, displays the proposed file
changes, and updates the lockfile after a safe install.

Useful options:

    agents update --dry-run
    agents update --interactive
    agents update official/nextjs --force
    agents update --scope global

`--force` is an explicit destructive choice and must clearly warn that local
changes may be overwritten.

### `agents diff`

Shows differences between installed files and package files at the locked or
incoming source commit:

    agents diff
    agents diff official/nextjs
    agents diff --scope global

### `agents check`

Checks that:

- the selected lockfile matches the selected manifest
- locked package commits are available and valid
- installed files match lockfile hashes
- no managed file is unexpectedly missing
- package ownership is unambiguous

    agents check --frozen
    agents check --scope global

## 11. Project manifest

Suggested `agents.yaml`:

    version: 1

    indexes:
      - https://github.com/example/agents-index.git

    packages:
      - id: official/nextjs
        scope: project
        source:
          type: git
          url: https://github.com/example/agent-files.git
          path: packages/nextjs
        selector: main

      - id: acme/base
        scope: project
        source:
          type: git
          url: git@github.com:acme/agent-standards.git
          path: base
        selector: v2.1.0

The source descriptor is written into the manifest after index resolution.
This makes future installation independent of a live registry.

Short references are allowed as CLI input. The on-disk manifest should favour
explicit Git source information. A package entry may also include an
`agents` list when `scope: global`:

    version: 1

    packages:
      - id: acme/base
        scope: global
        agents:
          - claude-code
          - codex
        source:
          type: git
          url: git@github.com:acme/agent-standards.git
          path: base
        selector: v2.1.0

For a global package entry, omitted `agents` means all compatible global
targets declared by the package. An explicit `agents` list filters those
targets. Unknown or unavailable agent adapters must produce a clear error,
not a write to a guessed path.

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
            sha256: sha256:...
          - scope: project
            path: CLAUDE.md
            sha256: sha256:...
          - scope: project
            path: .cursor/rules/nextjs.mdc
            sha256: sha256:...

Global lock (`global.lock`) uses the same schema:

    version: 1

    index:
      url: https://github.com/example/agents-index.git
      commit: 0123456789abcdef0123456789abcdef01234567

    packages:
      acme/base:
        scope: global
        agents:
          - codex
          - claude-code
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
            sha256: sha256:...
          - scope: global
            agent: claude-code
            path: CLAUDE.md
            sha256: sha256:...

The full Git commit is the primary immutable package version. Tags and
releases are human-friendly selectors that must resolve to commits.

The index commit is recorded when an index resolved a short package name. It
is not needed to install an already explicit source and locked commit. Lock
entries store logical target paths and adapter identifiers, never absolute
home-directory paths.

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
    select project/global targets and agent adapters
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
package cannot choose that root.

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
      agents diff official/nextjs

    Overwrite explicitly:
      agents update official/nextjs --force

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

Global writes require an explicit `--scope global` or `--global` flag and
must use the same local-modification protection as project writes.

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

    agents add official/nextjs@v1.4.0
    agents add official/nextjs@main

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

    agents add git@github.com:my-company/agent-standards.git#base

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
      agents add official/nextjs official/typescript official/prisma official/playwright

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

Rust is a strong implementation choice for the CLI:

- fast startup
- cross-platform executable
- robust filesystem handling
- suitable Git integration
- easy GitHub release distribution
- no requirement for Node.js or Python

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

    agents init
    agents init --global
    agents add
    agents install
    agents install --global
    agents remove
    agents list
    agents targets
    agents diff
    agents update

### Required behavior

- full Git commit locking
- explicit source URL and package path
- file ownership
- collision detection
- local modification protection
- safe path validation
- project and global installation scopes
- target adapters for supported agents
- explicit global writes with `--scope global` or `--global`
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

    agents init
    agents add github:example/agent-packages#nextjs

and produces:

    agents.yaml
    agents.lock
    AGENTS.md
    CLAUDE.md

On another machine:

    git clone demo
    cd demo
    agents install

must reproduce the same managed files from the locked Git commit, without
requiring the public index.

The following must also work:

    agents diff
    agents update
    agents remove official/nextjs

without silently overwriting or deleting locally modified files.

Global installation must also work independently:

    agents init --global
    agents add github:example/agent-packages#base --scope global --agent codex
    agents install --scope global

This must write only to the configured Codex global target, record the
resolved source commit in `global.lock`, and leave project files and
`agents.lock` unchanged. A later global update or removal must protect
locally modified global files.

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

> Install, share, version, and sync `AGENTS.md`, `CLAUDE.md`, Cursor rules,
> Copilot instructions, and other coding-agent configuration directly from
> Git repositories.

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
11. The public index is optional infrastructure.
12. Index metadata never replaces source package content.
13. The system is agent-neutral.
14. Simple file installation comes before clever composition.
15. Local changes are never silently destroyed.
16. A project remains usable if Agents or its public index disappears.
17. Every durable registry state has a reviewable Git representation.
