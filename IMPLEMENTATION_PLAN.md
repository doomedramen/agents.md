# Instruction composition: GPT-5.6 Luna implementation handoff

## Assignment

Implement this plan in phase order using GPT-5.6 Luna. Work solo unless the user requests delegation. Read repository instructions, inspect the current checkout, and preserve unrelated changes. Commit completed phases with a single author and push to the current branch's upstream. Do not publish to npm or modify external package repositories without an explicit request.

This document defines the proposed v2 behaviour. Some decisions replace requirements in `SPEC.md`; update that specification during implementation. Do not interpret old replacement semantics as permission to overwrite user edits in v2.

Start with Phase 1. Continue through the phases, verify each completion gate, and report completed work, remaining work, and commit IDs. If the session ends before completion, leave a progress entry here identifying the next phase and unresolved failures. Do not claim completion based on documentation or mocked tests alone.

## User outcomes and product scope

A company maintains agreed instructions in a private Git repository. Developers install and update those instructions on their machines. Teams compose project guidance from several technologies, such as TypeScript, Express, ConnectRPC, PostgreSQL, and Vitest, with project-owned additions. They review instruction changes through Git.

A solo developer installs community-contributed instruction packages from public Git repositories, combines conventions relevant to their project, and adds their own preferences. They need no company account, private index, machine pack, or organization setup. Make public and private Git sources equal participants in the same composition model. Anyone can publish a pack: a named collection of instruction packages for a personal workflow, project stack, community, or team.

This tool distributes standing rules and project context for `AGENTS.md`: architectural boundaries, code conventions, validation expectations, repository orientation, and team collaboration expectations. Skills cover task-specific procedures and supporting resources. Complement the skills ecosystem; do not install, execute, mirror, or repackage skills, or implement a competing skill format. A package may mention an existing skill and its purpose in prose, but the CLI must not infer a skill dependency or install it.

Keep community packages concise. For Express and ConnectRPC, useful guidance covers which transport owns which endpoints, where business logic belongs, and the project's error-handling conventions. Tutorials for creating handlers, command-by-command debugging workflows, and API reference dumps belong in separate skills or documentation. Fragment composition is a storage mechanism for standing guidance, not a task activation system.

Document two equally prominent getting-started paths: selecting public community packages for a personal project, and sharing company conventions. Avoid requiring a company baseline in the configuration schema or sample CLI flows.

Produce one canonical `AGENTS.md` per destination directory. Produce `CLAUDE.md` containing exactly `@AGENTS.md\n`. Use regular files. Packages contribute Markdown; consuming configurations choose destinations.

Project instructions must work from a fresh checkout without installing this CLI. Commit generated project instructions, configuration, and lockfile. Global installation state remains independent of project configuration. Include essential company rules in project configurations if CI must verify their presence; a developer's global configuration cannot provide a repository guarantee.

Composition is the core model. A package supplies standing guidance; an optional pack selects packages and their destinations. Use the same commands for either source type. An Express + MySQL + TypeScript + Prisma service normally receives one root `AGENTS.md` combining selected guidance and local additions. A Next.js/Hono Turborepo receives root conventions plus separate frontend/backend output files. Never split a single backend into instruction files merely because it uses several technologies.

## Current implementation and constraints

Baseline inspected at `8c821d9`, package version `0.1.6`:

- `src/cli.ts` exposes `add <source>` only.
- `src/manifest.ts` parses schema 1 packages with direct/import/copy targets.
- `src/install.ts` replaces files and writes state per scope. It does not protect local edits or provide a transaction across destinations.
- `src/git.ts` resolves Git sources and has `resolvePackageAt`. Local resolution can read uncommitted bytes while recording HEAD, so do not reuse that behaviour for v2 locked installs.
- `src/paths.ts` provides platform configuration directories and test home overrides.
- `src/types.ts` holds package and state types. Existing integration tests live in `test/add-local-package.test.ts`.

Keep Node.js >=20, TypeScript, the existing executable, and the current test runner. Confirm this baseline before editing; another task may have changed it.

## Product contracts

### Project configuration

Use consumer schema `version: 2`. Example:

```yaml
version: 2
packages:
  - id: typescript
    source: github:acme/agent-rules#packages/typescript
    ref: main
  - id: express
    source: github:acme/agent-rules#packages/express
    ref: main
  - id: prisma
    source: github:acme/agent-rules#packages/prisma
    ref: main
  - id: mysql
    source: github:acme/agent-rules#packages/mysql
    ref: main
packs: []
outputs:
  - directory: .
    use: [typescript, express, prisma, mysql]
    exclude: []
    local: [.agents/project.md]
    adapters: [claude-code]
```

`id` is a unique consumer alias. `source` retains the existing Git source syntax, with `#` meaning package subdirectory. `ref` is a branch, tag, or full commit; omission selects the remote default branch. Do not overload `#` with revision syntax. Do not add a registry or pretend `company/typescript` names a private registry entry.

An output directory owns `AGENTS.md` and the selected adapter files. Each output lists package or pack aliases in `use` order, followed by local files in listed order. Expand a pack in place, preserving its internal order. No implicit priority categories or alphabetical package sorting. Require unique aliases across `packages` and `packs`. Reject unknown fields, missing aliases, duplicate output directories, and repeated aliases within an output with useful field paths. Default new outputs to `adapters: [claude-code]`; an explicit empty list generates only `AGENTS.md`.

Local paths are relative to the consumer root, including for nested outputs. Output directories are normalized relative to that root. `--dir` uses that convention too. Require explicit `./` or `../` prefixes for local Git source arguments; normalize them to repository identity and subdirectory after resolving them. Do not confuse a GitHub shorthand with a local path.

For mixed monorepos, allow additional outputs such as `services/api` and `apps/web`, each selecting relevant packages. Do not copy root packages into nested outputs by default. Document that native agent loading determines which directory instructions an agent sees; do not promise universal precedence or exact glob-based loading across agents.

### Fragment package format

```yaml
schema: 2
name: connectrpc
description: Architectural conventions for ConnectRPC services
fragments:
  - id: boundaries
    source: boundaries.md
    title: Transport and business logic boundaries
  - id: errors
    source: errors.md
    title: ConnectRPC errors
```

Require unique fragment IDs within a package. Use consumer alias plus fragment ID as its identity, for example `connectrpc/errors`. Preserve declaration order. Packages cannot declare filesystem destinations, installation scope, scripts, or generated adapter content in schema 2.

Every example package must include a README describing its intended audience, assumptions, exclusions, and source license. Recommend authoring packages around coherent conventions so developers can review the installed text. Do not imply that a package's technology label makes its opinions universally applicable. Community maintainers can publish from ordinary Git repositories without registration in this project.

Compose a generated-file notice, then a labelled section per fragment and local file. Preserve Markdown bodies, normalize CRLF to LF, and define stable heading/blank-line/final-newline rules in renderer tests. Keep timestamps and absolute machine paths out of generated output. Record full provenance and hashes in the lockfile; do not fill the instructions with repeated commit metadata.

### Explicit exceptions and conflicts

Do not claim that putting a paragraph last guarantees an agent follows it. Resolve known alternatives before rendering.

In Phase 2, allow each output to specify `exclude: [alias/fragment-id]`; pack fragments use `pack-alias/member-alias/fragment-id`. Exclusions of unknown fragments are errors. Users can exclude an upstream recommendation and provide its replacement through a local file. Print exclusions in `diff` and retain them in lock provenance. If an update removes or renames an excluded fragment, fail before writes and identify the exclusion to reconcile.

Defer `requires` and `conflicts` declarations, version-aware dependency solving, and semantic contradiction detection. Manifest names are not globally unique: two public authors can publish `typescript`. Distinct source identities can coexist under different consumer aliases. Do not infer compatibility from names or silently remove similar prose. Users review combined guidance, with fragment IDs and provenance visible in diffs.

Company conventions remain guidance to the agent, not a security enforcement mechanism. For required project packages, a company can check the reviewed configuration in CI. Do not build a policy server.

### Lockfile, reproducibility, and cache

Use lockfile `version: 2`. Record normalized repository URL/path, requested ref, resolved full commit, package manifest hash, fragment content hashes, config fingerprint, local file hashes, renderer version, and hashes/ownership of generated files. Keep machine paths out of project locks except explicitly configured local development sources.

Resolve a package identity using repository plus package path, not manifest name alone. Distinct packages in the same repository must coexist. Resolve the same repository/ref once per operation so its packages share one commit snapshot. Locks must include pack recipe commits/hashes, member aliases, every external member's requested ref and resolved commit, and output membership edges for both pack and direct selections. A recipe commit alone does not pin its external dependencies.

Locked reads must use immutable Git content, including local repositories. A dirty source working tree must not alter installed bytes. Fetch the required commit when absent and explain inaccessible commits. Do not silently advance to HEAD. Do not fall back to an unverified checkout.

Cache verified package snapshots under the existing configured agents directory. `render` and `check` can use that cache without network access. A missing cache can fetch the locked commit unless `--offline` is set; offline cache misses must fail without changing project files. `check` may populate cache but never mutate managed project files.

### CLI semantics

All examples use `agents.md`; document the equivalent `npx @doomedramen/agents.md` invocation. Provide `--help`, command help, and unknown-option errors.

| Command | Contract |
| --- | --- |
| `init` | Create v2 config, empty `.agents/project.md`, lock, and root output. Refuse existing conflicting files; reruns leave valid initialized projects unchanged. |
| `init --adopt` | Preserve existing root `AGENTS.md` bytes in `.agents/project.md` before generating output. Accept an absent or exact import `CLAUDE.md`; refuse custom Claude content with instructions to reconcile it. Refuse a pre-existing local destination instead of overwriting it. |
| `add <source>... [--ref <ref>] [--dir <directory>] [--id <id>]` | Detect package or pack from its manifest. Resolve additions and append their aliases to selected outputs; retain existing locks. Default directory is `.`. Create a missing nested output when explicitly targeted. Default aliases to manifest names; require `--id` for a single source on collision. Re-adding an identical selection is a no-op. `--ref` applies to each top-level source in this invocation. |
| `remove <id>...` | Remove top-level package or pack selections from config and outputs, then recompose. Preserve independently selected packages and local files. Drop outputs created by a pack only if no remaining selections or local inputs need them; retain the initialized root output. Remove only unchanged generated files that lose ownership. |
| `render [--offline]` | Recompose from locked package commits and current local/config inputs. Permit output/local edits in config; reject changed package source/ref membership until `update` resolves it. Update derived lock fields. |
| `diff [--update]` | Show unified current-versus-planned content changes and package revisions. Default uses locked packages; `--update` resolves current refs. Do not modify consumer files. |
| `update [<id>...]` | Resolve selected top-level entries, or all when omitted, and apply output/config/lock changes as one recoverable operation. Updating a pack refreshes its recipe and all external member refs. Retain locks of unselected entries; reject incompatible shared-member revisions rather than advancing an unselected entry. An unfiltered update can resolve manual source-list changes; a filtered update rejects unrelated unresolved config changes. |
| `outdated` | Compare locked commits with requested remote refs; print old/new commits and return nonzero when updates exist. No consumer writes. |
| `check [--offline]` | Validate config/lock agreement, ownership, expected generated bytes, and adapters. Return nonzero on drift, missing output, or stale local-input hashes. Does not check whether remote refs advanced. |
| `detect` | Report evidence and suggested known packages from local project manifests. No writes or installation. |
| `edit [--dir <directory>]` | Open the output's primary consumer-owned Markdown file through `$VISUAL`, falling back to `$EDITOR`. If neither exists, print its absolute path and instructions to edit then render. Root defaults to `.agents/project.md`; nested defaults to `<directory>/.agents/project.md`. After a successful editor exit, recompose from locked sources. On editor/render failure preserve the local edits, leave generated files unchanged, and report the failure. |

Exit 0 for success/current, 1 for failed checks or available updates from `outdated`, and 2 for invalid input, missing cache, or operational failures. `diff` returns 0 for a valid diff even when changes exist. Do not make CI parse prose to distinguish an error from a valid diff.

Project commands require a root `agents.yaml` in the current directory; do not guess a parent project. `add` can initialize a missing v2 scope as part of the same planned transaction if no legacy state or unmanaged destination conflicts exist. `init --adopt` remains the explicit route for existing guidance. Detect source types by `agent.yaml` (package) versus `agents.yaml` with `kind: pack`; fail on ambiguous directories instead of guessing. Do not execute pack-supplied editor commands or lifecycle scripts.

Support `--global` on `init`, `add`, `remove`, `render`, `diff`, `update`, `outdated`, `check`, and `edit`. Reject `--dir` with `--global`. Do not implement a separate `pack` command namespace. All scope-changing operations use the same renderer and transaction engine. `add --dry-run` previews additions and adoption conflicts without changing consumer files, including first installation. Explicit adoption previews its preservation steps with `init --adopt --dry-run`.

### Packs and installation scope

Use **pack** for a shareable collection of instruction packages. Use **directory** for a filesystem location or a future discovery listing, not as a second name for the same collection. The [skills.sh packs documentation](https://www.skills.sh/docs/packs) provides the collection terminology; our packs contain AGENTS.md guidance and do not implement its skill format or hosted sharing service.

A pack is a Git directory with this `agents.yaml` recipe:

```yaml
version: 2
kind: pack
name: express-prisma-mysql
packages:
  - id: typescript
    source: ./packages/typescript
  - id: express
    source: ./packages/express
  - id: prisma
    source: ./packages/prisma
  - id: mysql
    source: ./packages/mysql
outputs:
  - directory: .
    use: [typescript, express, prisma, mysql]
```

Relative recipe sources resolve within its repository at the locked recipe commit, relative to the recipe directory. Allow `../` only when normalization remains inside that repository; reject escapes and symlinks. Relative members cannot specify independent refs. External members use explicit Git sources and may specify refs. Disallow nested packs in this release. Recipes may select fragments through `exclude`, but cannot contain local consumer files, agents, scripts, or credentials. Package authors place reusable Markdown in member packages.

A consumer records an installed pack explicitly:

```yaml
version: 2
packages: []
packs:
  - id: backend
    source: github:acme/agent-rules#packs/express-prisma-mysql
    ref: main
    directory: .
outputs:
  - directory: .
    use: [backend]
    exclude: [backend/express/routing]
    local: [.agents/project.md]
    adapters: [claude-code]
```

Here `routing` is illustrative and must exist in the selected package. Pack directories map under the consumer's chosen mount directory (`--dir`, default `.`). Add the pack alias to each mapped consumer output. At render time that alias expands only the recipe members for that output's relative directory. An output-level `use` list is authoritative: removing an alias there opts out of that output. Track opted-out recipe directories in a pack entry's optional `omitOutputs` list. Before reconciliation, compare current selections with the old lock to detect removed selections and persist those omissions; `update` must not silently re-add them. Reject a config that both includes and omits the same pack output. On install/update, append new recipe output selections in recipe order and remove obsolete contributions. Reject paths outside the consumer root. Record whether an output was explicitly created or introduced by a pack so removal is deterministic.

Within an output, deduplicate identical source identities at the same commit at their first occurrence. Retain all membership edges in the lock, so removal of a pack preserves direct selections and other packs' selections. Different requested refs or commits for one source identity are a conflict, even if the Markdown happens to match. Apply exclusions per contribution before deduplication and require all contributions of the same identity to select the same fragment set; otherwise report the conflicting selections. Distinct sources with the same manifest name are valid under unique aliases. Never deduplicate unrelated sources by content.

`update <pack-id>` updates the recipe and its external members; `diff --update` and `outdated` inspect both, even if the recipe commit is unchanged. Members are not independently addressable update targets: select the owning pack. `render` uses locked recipes and members without advancing refs. New installs may resolve newer refs; share a consumer lockfile when identical installations across machines are required. Record the recipe and all resolved dependencies so this distinction is visible.

Global scope uses one composition stored under `configDirectory()/global/agents.yaml`, `agents.lock`, and `local.md`, reusing current environment overrides. Use the same v2 packages/packs/outputs schema plus a global-only `agents: [claude-code]` field, defaulting to Claude on initialization; the only output directory is `.` and its local input is `local.md`. In global scope, omit output `adapters`; the registered agent selection determines adapter output. Multiple global packages and packs contribute to that one output. Reject packs with nested outputs in global scope. Do not create named exclusive profiles or per-pack ownership of generated files.

For Claude, write `~/.claude/AGENTS.md` and exact import `~/.claude/CLAUDE.md`. For Codex, write `~/.codex/AGENTS.md`. `init --global --agents claude-code,codex` selects registered destinations; `add --global --agents ...` is accepted only during initial scope creation. Later agent selection changes require editing global config and rendering. The global installation owns generated files, and removing one pack recomposes the remaining contributions. Retain an empty initialized output and personal local input after removing the last package.

Fail on unmanaged global guidance with an adoption instruction. `init --global --adopt` preserves existing canonical content into `local.md`; accept absent or exact-import Claude content and refuse custom Claude content. If selected agents have different existing canonical bytes, fail with their paths and require user reconciliation rather than choosing one. Preserve source bytes in a backup. Once adopted, personal additions remain independent of shared updates.

Do not install scheduled jobs. Document `outdated --global`, `diff --update --global`, and `update --global` for personal or team bootstrap workflows. `check --global` verifies installed bytes against the lock; it does not check freshness against a moving branch. Global instructions are guidance, not policy enforcement.

### Write safety and recovery

Compute and validate a complete write plan before changing consumer files. Include config, locks, ownership records, and stale-file removals. Compare existing generated bytes with the previous lock: missing files can be recreated; modified files cause an error and show how to preserve edits in a local fragment. Do not introduce a blanket force flag in this release.

Validate source/package paths, destination paths, and symlink ancestors. Reject traversal in manifest file paths and destinations, absolute package paths, Git source symlinks, destination symlinks, and overlaps with config, locks, local inputs, or cache/state directories. Recipe-relative Git sources use the explicit repository containment exception described above; CLI local Git sources are resolved separately. Permit `.` only for explicitly defined directory roots. Account for case-insensitive destination collisions on supported filesystems.

Use an operation lock against concurrent writers. Stage replacements, preserve backups, and write a recovery journal before applying changes. Recheck expected destination hashes immediately before applying. A multi-directory rename cannot provide cross-file atomicity: implement rollback on caught failures and journal recovery after interruption, then test both. Never leave a lockfile claiming success for partially written output.

### Compatibility

Preserve schema 1 behaviour behind its existing code path while building v2. Existing legacy tests must pass. Without v2 config, `add` of a schema 1 package retains the legacy path; schema 2 packages/packs use safe initialization described above. Reject mixed schema 1/v2 source batches before writes. Refuse legacy operations that overlap an existing v2 installation, including registered global targets. In a v2 project, reject new schema 1 sources with a migration explanation instead of triggering legacy destination writes.

Provide `migrate --dry-run` and `migrate` for existing consumer state. Support the narrow case of project-only schema 1 packages with one canonical Markdown file and its Claude import adapter. Adapt those locked sources into one fragment per package through a documented v1-to-fragment compatibility reader. Preserve commits and user edits through local adoption. Reject multiple legacy owners of the same path, custom targets, mixed/global state, or ambiguous local edits without changing files. Offer a manual migration recipe for those cases. Do not silently guess which package's overwritten rules the team intended to retain.

Migration records `compatibility: v1-canonical` on each adapted package entry and in its lock. Permit this field only with the documented compatible source shape; it never enables legacy destination writes. `render` and `check` read the locked canonical file as one fragment with ID `canonical`. `update` revalidates that shape at the new commit before adapting it; schema changes or incompatible destinations fail without writes. Migration of edited generated content fails with preservation instructions rather than duplicating the complete old output as a local addition. Test render, check, and update after migration, not just the initial conversion.

Do not bump npm version or publish. Keep the schema/consumer compatibility change explicit in release notes for the eventual release.

## Implementation phases and completion gates

### Phase 1: Contracts and immutable sources

Add versioned package/config/lock parsing and example fixtures. Extend Git resolution for explicit refs and immutable local/remote commit reads. Build verified snapshot cache. Keep existing v1 entry points working.

Gate: parser tests reject malformed fields, duplicate aliases/fragments, invalid refs/paths, and unknown schema versions. Integration tests resolve two packages from one repository, retrieve an old commit after HEAD moves, ignore dirty working-tree changes, and reject source symlink escapes. A cached locked read works offline; an offline miss fails clearly.

### Phase 2: Pure composition

Implement `compose(config, lockedPackages, localFragments): RenderPlan`. Inputs contain bytes and provenance, not filesystem handles. Outputs contain generated bytes, diagnostics, and intended ownership; snapshot reads and writes happen outside the composer. Add nested output support, fragment exclusions, and stable formatting. Parse the pack contract in Phase 1; pack expansion into these inputs arrives in Phase 5.

Gate: exact expected output for Express + MySQL + TypeScript + Prisma + local notes in one root file; repeat invocation has identical bytes; changing one fragment affects only outputs selecting that package; nested outputs omit root-only packages; Claude output is exactly `@AGENTS.md\n`. Excluding a fragment removes only that fragment, and unknown exclusions fail. Different source packages with the same name remain distinguishable through aliases.

### Phase 3: Safe application and core commands

Implement transaction/recovery module, ownership validation, `init`, adoption, `add`, `remove`, `render`, `edit`, and `check` for project scope. Implement `--dir`, safe first-add initialization, and dry-run previews. Wire CLI help and exit codes. Preserve v1 compatibility paths.

Gate: an end-to-end temporary Git fixture can initialize, add several packages, add local notes, render, check, and remove one package without losing others. Adding Next.js under `apps/web` and Hono under `apps/api` creates the correct outputs. Test an editor stub, unset editor variables, editor failure, and preservation of local edits on render failure. Refuse modified generated files and custom unmanaged Claude content. Simulated failure after one replacement rolls back all managed bytes; interruption recovery restores consistency. Concurrent operations cannot corrupt state. Ancestor symlinks and destination/input collisions fail before writes.

### Phase 4: Updates and migration

Implement `diff`, `update`, `outdated`, and narrow v1 migration. Retain unchanged package locks when updating a selected alias. Include full recipe/config changes in planned validation before applying.

Gate: source commit A installs, source B appears, `check` remains successful while `outdated` reports B, `diff --update` previews B without writes, `update` installs B, and `check` succeeds. Local notes survive. Migration preserves locked source content and produces a checkable v2 project that can render and update; unsupported migration leaves original bytes untouched. Invalid new package content or stale exclusions produce no partial update.

### Phase 5: Shareable packs and global composition

Implement recipe resolution and pack expansion behind the existing command set. Implement global scope, global adoption, registered agent destinations, and one global owner. Use the same renderer, snapshot cache, and recovery engine. Preserve pack output membership and scoped exceptions across updates.

Gate: with `AGENTS_TEST_HOME` and `AGENTS_CONFIG_DIR` set to temporary directories, add two packs and an individual package globally, exclude a rule, edit local guidance, update one pack, and remove it. Remaining guidance and direct selections must survive. Repeat in project scope. Tests must never touch the developer's real agent directories. Relative recipe sources use the recipe's locked commit. External dependency advancement without recipe changes appears in outdated/diff/update. A filtered update that conflicts with an unselected shared dependency fails without writes. Test new/removed nested recipe outputs, opted-out outputs, source deduplication, mismatched exclusions, and pack/direct ownership retention. Test differing unmanaged global canonical files and refusal of overlapping legacy writes.

### Phase 6: Examples, documentation, and core release readiness

Add local example packages and packs for the two walkthroughs below under `examples/`, with standing conventions rather than task tutorials. Include a solo-developer setup with no team baseline and a team setup using the same commands. Add an author guide covering applicability, licensing, fragment IDs, relative source resolution, and how to share a pack through Git. No hosted registry is required. Do not label nonexistent repositories as working install sources.

Rewrite `SPEC.md` to match implemented contracts and remove contradictory scope/replacement rules. Update README with public installation, team onboarding, one-file backend composition, monorepo outputs, local additions, exclusions, drift versus freshness, and migration examples. Explain standing AGENTS.md guidance versus task-specific skills. Link only to commands that exist.

Run `npm run check`, `git diff --check`, and `npm pack --dry-run --json`. Run both walkthroughs through the built executable with temporary Git fixture repositories and a fake home. Verify npm package includes README and required runtime files. Do not publish or bump the npm version.

Gate: a reader can initialize a project, review public guidance, compose a mixed stack, preserve personal notes, and review an upstream update. Tests cover both project examples and multiple global packs. Record test evidence, limitations, and final implementation commit. Phases 1–6 define the first usable release; do not block this gate on optional detection work.

### Phase 7: Optional follow-up, stack detection

After the core gate passes, implement a small static detection catalog for TypeScript, Express, Prisma, MySQL clients, Next.js, Hono, and Turborepo using dependencies/devDependencies and project configuration. Include file/field evidence. A MySQL client indicates use of that client, not a guaranteed live database; Prisma alone does not establish the database provider. Support root and npm/pnpm workspace manifests without scanning node_modules or executing scripts.

Suggestions reference explicit configured/example Git sources. Missing a detection catalog should yield detected technologies without invented package URLs. Do not infer that detected dependencies require installing guidance. Keep detection read-only. Before Phase 7 exists, CLI help must omit `detect` rather than expose a placeholder.

Gate: fixture detection reports evidence and workspace locations, deduplicates evidence, handles malformed manifests, and makes no consumer changes. Update docs and rerun relevant tests plus the build. Discovery directories, rankings, and a hosted website remain separate work.

## Acceptance walkthroughs

These are proposed commands. Repository names are placeholders: automated tests must substitute local Git fixtures and documentation must use verified example sources or label placeholders. Private sources use normal Git credentials; solo developers need no organization account.

### Global guidance, shared by either project workflow

```sh
agents.md add github:your-team/agent-rules#packs/default --global --dry-run
agents.md add github:your-team/agent-rules#packs/default --global
agents.md edit --global
agents.md check --global
```

If existing guidance conflicts, explicitly adopt/reconcile it first. Generate `~/.claude/AGENTS.md` and an exact import `~/.claude/CLAUDE.md`; keep local personal text in the global `local.md`. A solo developer can replace the team source with a public package/pack or their own repository. Neither needs a company profile. Adding a second global pack must compose with the first.

### Express + MySQL + TypeScript + Prisma

```sh
agents.md init
agents.md add github:community/agent-rules#packages/typescript
agents.md add github:community/agent-rules#packages/express
agents.md add github:community/agent-rules#packages/prisma
agents.md add github:community/agent-rules#packages/mysql
agents.md edit
agents.md check
```

Expect exactly one root `AGENTS.md` combining all selected fragments plus `.agents/project.md`. Root `CLAUDE.md` contains only `@AGENTS.md` and a newline. No nested files appear just because multiple technologies were selected. Test local context such as route/service directories and validation commands. Team members can add a shared project baseline; solo users can omit it. Global content is not copied into the project file.

As a separate equivalent fixture, install the `express-prisma-mysql` pack with one `add` command and confirm the same selected instruction bodies. Use an exclusion whose ID exists in the fixture, replace its convention through local Markdown, and verify the excluded text does not appear. Generated provenance labels may differ between direct and pack selections; compare bodies and order for equivalence.

### Next.js frontend + Hono backend in a Turborepo

```sh
agents.md init
agents.md add github:community/agent-rules#packages/turborepo
agents.md add github:community/agent-rules#packages/nextjs --dir apps/web
agents.md add github:community/agent-rules#packages/hono --dir apps/api
agents.md edit
agents.md edit --dir apps/web
agents.md edit --dir apps/api
agents.md check
```

Expect root `AGENTS.md` for workspace conventions, `apps/web/AGENTS.md` for frontend guidance, and `apps/api/AGENTS.md` for backend guidance, each with an adjacent Claude import. Keep root rules out of the nested generated bodies. Test a pack recipe mapping `.` to Turborepo, `apps/web` to Next.js, and `apps/api` to Hono; its one-command installation produces the same directory layout. The tool does not scaffold the application itself.

For both examples, commit the project config, lock, generated instructions, and local source files. Simulate an upstream change and run `diff --update`, `update`, and `check`; repeat with `--global`. Verify project commands do not alter global scope or vice versa, and local additions survive. Remove a pack after also selecting one of its member packages directly; the direct contribution must remain.

## Suggested code ownership within this task

Use `src/manifest.ts` for package decoding and new `src/config.ts` / `src/lock.ts` for consumer contracts. Keep `src/git.ts` responsible for transport and immutable snapshots, with `src/cache.ts` if needed. Put pure rendering in `src/compose.ts`, filesystem recovery in `src/transaction.ts`, orchestration in `src/project.ts` and `src/pack.ts`, and detection in `src/detect.ts`. Keep CLI parsing and human output in `src/cli.ts`.

These filenames are guidance, not a requirement to add pass-through modules. Test behaviour through the composer and public CLI; use failure injection at the filesystem seam to test recovery. Do not add unrelated frameworks or rewrite the project into a plugin architecture.

## Deferred work

Do not implement a hosted registry, web dashboard, automatic background updater, semantic Markdown merge, package lifecycle scripts, version-range dependency solver, managed symlinks, AI contradiction resolver, signed-policy system, or integrations that message teammates. Do not infer that guidance ordering enforces instruction priority. These can receive separate plans after the core workflow works.

## Progress

- Phases 1–7 implemented. v2 packages, packs, immutable Git/cache reads, pure composition,
  transactional recovery, project/global commands, migration, examples/docs, and static
  detection are complete. Schema 1 remains isolated behind its legacy path and narrow
  migration reader; schema 2 has no pre-v2 destination compatibility requirement.
- Verified with `npm run check` (11 passing tests), `git diff --check`, and
  `npm pack --dry-run --json`. Built-executable walkthroughs covered direct mixed stacks,
  nested outputs, pack expansion/omissions, global Claude/Codex destinations, adoption,
  migration, immutable dirty-source reads, update/diff/outdated, and offline checks.
- Implementation commits pushed to `origin/main`: `55afc9c`, `356fe27`, `3dd7ef1`,
  `5877bff`, `78346ee`, `60df6cf`, `886da84`, and `92d3718`.
