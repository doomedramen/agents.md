# agents.md v2 specification

`agents.md` composes standing Markdown guidance from ordinary Git repositories.
It does not install skills, run package scripts, or provide a registry. Git
repositories, commits, pull requests, and the consumer lockfile remain the
source of truth.

## Consumer files

Project scope stores `agents.yaml`, `agents.lock`, `.agents/project.md`,
`AGENTS.md`, and (by default) `CLAUDE.md`. Global scope stores
`<config>/global/agents.yaml`, `agents.lock`, and `local.md`, then writes
registered agent destinations under the test/home directory. Project paths are
relative to the consumer root. Global config has one output, `.`.

Project configuration:

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

`id` is a unique consumer alias across packages and packs. `source` keeps Git
repository and package path in one value; `#` never carries a revision.
`ref` is optional and means branch, tag, or full commit. Local sources must use
an explicit `./` or `../` prefix. Output `use` order is authoritative. Local
files follow selected package contributions in listed order. A pack expands in
its recipe order.

Unknown fields, unsafe paths, duplicate aliases, duplicate output directories,
repeated output aliases, and unknown exclusions are errors. `adapters: []`
means generate only `AGENTS.md`; omitted project adapters default to
`[claude-code]`. Global config uses `agents: [claude-code, codex]` and omits
output adapters.

## Package files

Schema 2 packages use `agent.yaml`:

```yaml
schema: 2
name: express
description: Architectural conventions for Express services
fragments:
  - id: boundaries
    source: boundaries.md
    title: Transport and business-logic boundaries
```

Fragment IDs are unique within a package and declaration order is preserved.
Fragment paths stay inside the package Git tree. Package Markdown should contain
coherent standing conventions: boundaries, code conventions, validation
expectations, repository orientation, and collaboration expectations. Handler
tutorials, debugging procedures, and reference dumps belong in skills or docs.
Authors should include a README covering audience, assumptions, exclusions, and
source license. A technology label is not a claim of universal applicability.

Schema 1 remains readable by the legacy installer and by the narrow migration
reader. It never participates in v2 destination writes.

## Packs

A pack is an `agents.yaml` Git recipe with `version: 2`, `kind: pack`, a name,
package members, and output mappings. Relative member sources resolve from the
recipe directory at the locked recipe commit and cannot specify independent
refs. External members may specify refs. Nested packs, scripts, credentials,
consumer local files, and lifecycle commands are not supported.

Pack aliases, member aliases, and fragment IDs form exclusion paths such as
`backend/express/routing`. Consumer output membership remains authoritative;
removing a pack alias opts out of that recipe output and v2 records the choice
in `omitOutputs`. Direct package selections survive pack removal.

The renderer deduplicates one identical repository/package/commit identity at
its first occurrence. It retains all membership edges in the lock and rejects
different requested revisions or fragment selections for one identity.

## Rendering and locks

Every generated Markdown file starts with a generated-file notice, then one
labelled section per selected fragment and local input. Bodies normalize CRLF to
LF. Output ends with one newline. Provenance labels contain aliases and
fragment IDs, not timestamps, absolute paths, or commit metadata. Claude
adapters contain exactly `@AGENTS.md\n`.

Lock version 2 records normalized source descriptors, requested refs, resolved
commits, manifest and fragment hashes, pack recipe/member commits, output
membership, exclusions, local hashes, renderer version, generated hashes, and
ownership. Locked reads use immutable Git snapshots and the verified cache.
Dirty local working trees never alter locked bytes. `render` and `check` may
populate cache; `--offline` turns a missing cache entry into an error.

Generated files are protected by their previous lock hash. Missing files can be
recreated. Modified generated files fail with preservation instructions.
Operations compute all writes first, use an operation lock, stage replacements,
write a recovery journal, and roll back caught failures. Symlink ancestors,
destination symlinks, traversal, source escapes, state/cache overlaps, and
case-insensitive destination collisions are rejected.

## Commands

```text
init [--global] [--adopt] [--agents <list>] [--dry-run]
add <source>... [--ref <ref>] [--dir <directory>] [--id <id>] [--global]
remove <id>... [--global]
render [--offline] [--global]
diff [--update] [--global]
update [<id>...] [--global]
outdated [--global]
check [--offline] [--global]
detect
edit [--dir <directory>] [--global]
migrate [--dry-run]
```

`init` creates a valid empty v2 scope. `init --adopt` moves existing canonical
guidance into the configured local input and keeps a backup; custom Claude
content and conflicting global canonical files require reconciliation.
`add` detects package versus pack, resolves additions, updates output
membership, and applies one transaction. `remove` recomposes remaining
contributions. `render` uses locked sources only. `diff --update` previews moving
refs without writes. `update` resolves selected aliases or all aliases and
updates recipe dependencies. `outdated` compares refs and returns exit 1 when
updates exist. `check` validates lock agreement, local/generated bytes, and
adapters without checking remote freshness. `edit` opens the first local input
with `$VISUAL` or `$EDITOR` and renders after a successful exit.

Exit codes: 0 success/current, 1 failed checks or available updates from
`outdated`, 2 invalid input, missing cache in offline mode, or operational
failure. `diff` returns 0 for a valid diff even when content changes exist.

Project commands require `agents.yaml` in the current directory. They do not
search parent directories. `add` may initialize a missing v2 scope when no
legacy state or unmanaged destination conflicts exist. `--global` uses the same
composition engine and registered Claude/Codex destinations; it does not install
scheduled jobs.

## Migration

`migrate --dry-run` and `migrate` support only project schema 1 packages with
one canonical `AGENTS.md` target and its exact Claude import. Multiple owners,
custom targets, global/mixed state, or edited generated bytes fail without
writes. Compatible sources become one locked `canonical` fragment per package
with `compatibility: v1-canonical`. Incompatible future updates fail before
writes. Unsupported cases require a manual review: preserve the old generated
file in a local fragment, create schema 2 selections, and remove legacy state
only after `check` succeeds.

## Scope and agent behavior

Project outputs may be root or nested, for example `services/api` and
`apps/web`. Native agent loading determines which directory instructions an
agent sees. This tool does not promise universal precedence or exact glob
loading across agents. `AGENTS.md` is standing guidance and project context;
task-specific skills remain separate and are not installed or inferred.
