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

Project instructions must work from a fresh checkout without installing this CLI. Commit generated project instructions, configuration, and lockfile. Machine packs remain independent of project configuration. Include essential company rules in project configurations if CI must verify their presence; a developer's global configuration cannot provide a repository guarantee.

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
  - id: company
    source: github:acme/agent-rules#packages/company
    ref: main
  - id: typescript
    source: github:acme/agent-rules#packages/typescript
    ref: main
  - id: express
    source: github:acme/agent-rules#packages/express
    ref: main
  - id: connectrpc
    source: github:acme/agent-rules#packages/connectrpc
    ref: main
outputs:
  - directory: .
    packages: [company, typescript, express, connectrpc]
    local: [.agents/project.md]
    adapters: [claude-code]
```

`id` is a unique consumer alias. `source` retains the existing Git source syntax, with `#` meaning package subdirectory. `ref` is a branch, tag, or full commit; omission selects the remote default branch. Do not overload `#` with revision syntax. Do not add a registry or pretend `company/typescript` names a private registry entry.

An output directory owns `AGENTS.md` and the selected adapter files. Each output lists package aliases in composition order, followed by local files in listed order. No implicit priority categories or alphabetical package sorting. Reject unknown fields, missing aliases, duplicate output directories, and repeated aliases within an output with useful field paths.

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

In Phase 7, allow each output to specify `exclude: [alias/fragment-id]`. Exclusions of unknown fragments are errors. Users can exclude an upstream recommendation and provide its replacement through a local file. Print exclusions in `diff` and retain them in lock provenance.

Phase 7 packages may declare `requires: [package-name]` and `conflicts: [package-name]`. Evaluate these against packages selected for each output, not all packages in the config. Requirements validate explicit selection; they do not fetch transitive dependencies. Duplicate package names within an output are errors, avoiding ambiguous requirements. Version-aware dependency solving and automatic semantic contradiction detection are out of scope.

Company conventions remain guidance to the agent, not a security enforcement mechanism. For required project packages, a company can check the reviewed configuration in CI. Do not build a policy server.

### Lockfile, reproducibility, and cache

Use lockfile `version: 2`. Record normalized repository URL/path, requested ref, resolved full commit, package manifest hash, fragment content hashes, config fingerprint, local file hashes, renderer version, and hashes/ownership of generated files. Keep machine paths out of project locks except explicitly configured local development sources.

Resolve a package identity using repository plus package path, not manifest name alone. Distinct packages in the same repository must coexist. Resolve the same repository/ref once per operation so its packages share one commit snapshot.

Locked reads must use immutable Git content, including local repositories. A dirty source working tree must not alter installed bytes. Fetch the required commit when absent and explain inaccessible commits. Do not silently advance to HEAD. Do not fall back to an unverified checkout.

Cache verified package snapshots under the existing configured agents directory. `render` and `check` can use that cache without network access. A missing cache can fetch the locked commit unless `--offline` is set; offline cache misses must fail without changing project files. `check` may populate cache but never mutate managed project files.

### CLI semantics

All examples use `agents.md`; document the equivalent `npx @doomedramen/agents.md` invocation. Provide `--help`, command help, and unknown-option errors.

| Command | Contract |
| --- | --- |
| `init` | Create v2 config, empty `.agents/project.md`, lock, and root output. Refuse existing conflicting files; reruns leave valid initialized projects unchanged. |
| `init --adopt` | Preserve existing root `AGENTS.md` bytes in `.agents/project.md` before generating output. Accept an absent or exact import `CLAUDE.md`; refuse custom Claude content with instructions to reconcile it. Refuse a pre-existing local destination instead of overwriting it. |
| `add <source>... [--ref <ref>]` | Resolve additions and append aliases to the root output; retain other package commits. Use manifest names as default aliases; on alias collision require a unique alias with `--id` for a single source. Require an initialized v2 config. |
| `remove <id>...` | Remove aliases from configuration and output selections, then recompose. Remove only unchanged generated files that lose ownership; retain user-owned local files. Fail unmet requirements. |
| `render [--offline]` | Recompose from locked package commits and current local/config inputs. Permit output/local edits in config; reject changed package source/ref membership until `update` resolves it. Update derived lock fields. |
| `diff [--update]` | Show unified current-versus-planned content changes and package revisions. Default uses locked packages; `--update` resolves current refs. Do not modify consumer files. |
| `update [<id>...]` | Resolve selected refs, or all packages when omitted, and apply output/config/lock changes as one recoverable operation. Can resolve manual package-list changes. |
| `outdated` | Compare locked commits with requested remote refs; print old/new commits and return nonzero when updates exist. No consumer writes. |
| `check [--offline]` | Validate config/lock agreement, ownership, expected generated bytes, and adapters. Return nonzero on drift, missing output, or stale local-input hashes. Does not check whether remote refs advanced. |
| `detect` | Report evidence and suggested known packages from local project manifests. No writes or installation. |

Exit 0 for success/current, 1 for failed checks or available updates from `outdated`, and 2 for invalid input, missing cache, or operational failures. `diff` returns 0 for a valid diff even when changes exist. Do not make CI parse prose to distinguish an error from a valid diff.

Allow output selection through YAML first. Avoid an interactive configuration editor in this release. `add` must fail clearly if there is no root output and explain how to edit output selections.

### Packs and installation scope

Use **pack** for a shareable collection of instruction packages. Use **directory** for a filesystem location or a future discovery listing, not as a second name for the same collection. The [skills.sh packs documentation](https://www.skills.sh/docs/packs) provides the collection terminology; our packs contain AGENTS.md guidance and do not implement its skill format or hosted sharing service.

A pack can be installed into a project or at user-global scope. Scope belongs to the installation, not the pack author or an organization type. Store user-global named packs under `configDirectory()/packs/<name>/`, reusing current environment overrides. Do not introduce a second hardcoded `~/.agents` state directory.

A pack source is a Git directory containing a v2 `agents.yaml` recipe. Project installations record the pack source, ref, resolved commit, and expanded package selections in the project lock; updates must retain pack membership provenance, including additions and removals. Resolve package-relative sources against the recipe's repository and locked commit; explicit external Git sources remain supported. Project installs apply recipe output directories relative to the consuming project. Global installs accept only a root output and select registered agents (`claude-code`, `codex`) through installation options; reject nested recipe outputs for global scope. Store agent choices in installation state, so the same root pack can serve either scope. Copy locked local recipe fragments into verified snapshot storage; never treat a remote recipe path as an arbitrary local path.

Provide `pack install <name> <source> [--ref <ref>] [--global]`, `pack diff <name> [--update]`, `pack update <name>`, `pack check <name> [--offline]`, `pack outdated <name>`, and `pack remove <name>`. Default to project scope. Support `--global` on all pack commands to address the user-global installation; identical names in the two scopes identify separate installations. For global install, accept `--agents claude-code,codex`, defaulting to `claude-code`. Share composition and transaction code with project commands. A project pack must coexist with individually added packages: track membership, deduplicate identical source/ref entries, reject conflicting aliases or refs, and preserve independently selected packages on pack removal. Compose multiple packs in installation order, preserving each pack's internal order.

For Claude, write `~/.claude/AGENTS.md` and exact import `~/.claude/CLAUDE.md`. For Codex, write `~/.codex/AGENTS.md`. A machine ownership index prevents two packs from owning the same destination. Do not silently switch packs. Fail on existing unmanaged guidance, with a concrete backup/reconciliation instruction. Removing a pack deletes only unchanged files it owns and retains a recovery backup.

Do not install scheduled jobs. Document running `pack outdated` to detect upstream pack updates, `pack diff --update` to review them, and `pack update` to apply them through a personal or team bootstrap workflow. `pack check` verifies the installed lock, not freshness against a moving branch.

### Write safety and recovery

Compute and validate a complete write plan before changing consumer files. Include config, locks, ownership records, and stale-file removals. Compare existing generated bytes with the previous lock: missing files can be recreated; modified files cause an error and show how to preserve edits in a local fragment. Do not introduce a blanket force flag in this release.

Validate source/package paths, destination paths, and symlink ancestors. Reject traversal, absolute package paths, Git source symlinks, destination symlinks, and overlaps with config, locks, local inputs, or cache/state directories. Permit `.` only for explicitly defined directory roots. Account for case-insensitive destination collisions on supported filesystems.

Use an operation lock against concurrent writers. Stage replacements, preserve backups, and write a recovery journal before applying changes. Recheck expected destination hashes immediately before applying. A multi-directory rename cannot provide cross-file atomicity: implement rollback on caught failures and journal recovery after interruption, then test both. Never leave a lockfile claiming success for partially written output.

### Compatibility

Preserve schema 1 behaviour behind its existing code path while building v2. Existing legacy tests must pass. Without a v2 config, `add` retains its schema 1 path; installing a schema 2 source asks the user to run `init`. In a v2 project, reject schema 1 sources with a migration explanation instead of triggering legacy destination writes.

Provide `migrate --dry-run` and `migrate` for existing consumer state. Support the narrow case of project-only schema 1 packages with one canonical Markdown file and its Claude import adapter. Adapt those locked sources into one fragment per package through a documented v1-to-fragment compatibility reader. Preserve commits and user edits through local adoption. Reject multiple legacy owners of the same path, custom targets, mixed/global state, or ambiguous local edits without changing files. Offer a manual migration recipe for those cases. Do not silently guess which package's overwritten rules the team intended to retain.

Do not bump npm version or publish. Keep the schema/consumer compatibility change explicit in release notes for the eventual release.

## Implementation phases and completion gates

### Phase 1: Contracts and immutable sources

Add versioned package/config/lock parsing and example fixtures. Extend Git resolution for explicit refs and immutable local/remote commit reads. Build verified snapshot cache. Keep existing v1 entry points working.

Gate: parser tests reject malformed fields, duplicate aliases/fragments, invalid refs/paths, and unknown schema versions. Integration tests resolve two packages from one repository, retrieve an old commit after HEAD moves, ignore dirty working-tree changes, and reject source symlink escapes. A cached locked read works offline; an offline miss fails clearly.

### Phase 2: Pure composition

Implement `compose(config, lockedPackages, localFragments): RenderPlan`. Inputs contain bytes and provenance, not filesystem handles. Outputs contain generated bytes, diagnostics, and intended ownership; snapshot reads and writes happen outside the composer. Add nested output support and stable formatting.

Gate: exact expected output for company + TypeScript + Express + ConnectRPC + local notes; repeat invocation has identical bytes; changing one fragment affects only outputs selecting that package; nested outputs omit root-only packages; Claude output is exactly `@AGENTS.md\n`.

### Phase 3: Safe application and core commands

Implement transaction/recovery module, ownership validation, `init`, adoption, `add`, `remove`, `render`, and `check`. Wire CLI help and exit codes. Preserve v1 compatibility paths.

Gate: an end-to-end temporary Git fixture can initialize, add several packages, add local notes, render, check, and remove one package without losing others. Refuse modified generated files and custom unmanaged Claude content. Simulated failure after one replacement rolls back all managed bytes; interruption recovery restores consistency. Concurrent operations cannot corrupt state. Ancestor symlinks and destination/input collisions fail before writes.

### Phase 4: Updates and migration

Implement `diff`, `update`, `outdated`, and narrow v1 migration. Retain unchanged package locks when updating a selected alias. Include full recipe/config changes in planned validation before applying.

Gate: source commit A installs, source B appears, `check` remains successful while `outdated` reports B, `diff --update` previews B without writes, `update` installs B, and `check` succeeds. Local notes survive. Migration preserves locked bytes and produces a checkable v2 project; unsupported migration leaves original bytes untouched. Invalid new package content produces no partial update.

### Phase 5: Shareable packs

Implement recipe resolution, named pack commands, registered output adapters, and cross-pack ownership checks. Use the same renderer, snapshot cache, and recovery engine.

Gate: with `AGENTS_TEST_HOME` and `AGENTS_CONFIG_DIR` set to temporary directories, install/update/check/remove a public pack in a project and a private/team pack globally for Claude and Codex. Test the same root pack in both scopes, pack membership updates, and preservation of individually installed packages after pack removal. Tests must never touch the developer's real agent directories. Reject pack ownership collisions and preserve modified global guidance. Relative recipe sources use the recipe's locked commit. Demonstrate the freshness-versus-drift distinction for packs.

### Phase 6: Stack detection and starter recipes

Implement a small static detection catalog for TypeScript, Express, ConnectRPC, PostgreSQL clients, and Vitest using dependencies/devDependencies and project config files. Include file/field evidence. A PostgreSQL client indicates use of that client, not a guaranteed live database. Support root and npm/pnpm workspace package manifests without scanning node_modules. Detection reads local files and does not invoke package scripts.

Add local example packages and a mixed-service recipe under `examples/` for documentation and smoke testing. Suggestions refer to explicit configured/example sources; do not invent a hosted official registry. Teams can copy a recipe as a starting config for new projects; recipes do not scaffold application source code.

Include a solo-developer recipe with no company package or pack. Add a package-author guide and a contribution template covering standing guidance, applicability, license, and public Git installation. Keep discovery lightweight for this release: README links to reviewed examples and explicit Git sources. A future community directory can index instruction packages and their provenance without hosting skills or becoming required for installation.

Gate: fixture-based detection reports technologies and their workspace locations, deduplicates evidence, handles absent/malformed manifests with clear diagnostics, and leaves the fixture unchanged. Document the supported detection scope. A solo-developer fixture composes packages from two independent Git repositories without a pack or company configuration. Review example content for standing conventions; remove task tutorials and skill implementations.

### Phase 7: Explicit exceptions and package constraints

Implement fragment exclusions and output-level requires/conflicts validation described above. Show stable fragment IDs in diagnostics and diffs. Document project replacement examples and conflicting-stack resolution.

Gate: missing requirements and declared conflicts prevent writes; unrelated outputs can select different stacks; excluding a fragment removes only that fragment; unknown exclusions fail; removing a required package fails without modifying config or output.

### Phase 8: Documentation and release readiness

Rewrite `SPEC.md` to match implemented contracts and remove contradictory scope/replacement rules. Update README with public community installation and company onboarding, mixed-stack composition, local additions, nested outputs, drift versus freshness, and migration examples. Explain the distinction between standing AGENTS.md guidance and task-specific skills, with examples. Link only to commands that exist. Retain simple install instructions.

Run `npm run check`, `git diff --check`, and `npm pack --dry-run --json`. Run an end-to-end workflow through the built executable, including project/global pack installation and mixed-stack examples. Verify npm package includes README and required runtime files. Do not publish.

Gate: a reader can follow documented commands in a fresh temporary repository, review an upstream update, and preserve project notes. Record tests, known limitations, and the final commit in the progress section.

## Suggested code ownership within this task

Use `src/manifest.ts` for package decoding and new `src/config.ts` / `src/lock.ts` for consumer contracts. Keep `src/git.ts` responsible for transport and immutable snapshots, with `src/cache.ts` if needed. Put pure rendering in `src/compose.ts`, filesystem recovery in `src/transaction.ts`, orchestration in `src/project.ts` and `src/pack.ts`, and detection in `src/detect.ts`. Keep CLI parsing and human output in `src/cli.ts`.

These filenames are guidance, not a requirement to add pass-through modules. Test behaviour through the composer and public CLI; use failure injection at the filesystem seam to test recovery. Do not add unrelated frameworks or rewrite the project into a plugin architecture.

## Deferred work

Do not implement a hosted registry, web dashboard, automatic background updater, semantic Markdown merge, package lifecycle scripts, version-range dependency solver, managed symlinks, AI contradiction resolver, signed-policy system, or integrations that message teammates. Do not infer that guidance ordering enforces instruction priority. These can receive separate plans after the core workflow works.

## Progress

- Planning complete. Implementation has not started.
- Next: Phase 1, after reading current repository instructions and checking for intervening changes.
