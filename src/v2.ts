import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { compose, GENERATED_NOTICE, RENDERER_VERSION, renderClaudeAdapter, sha256 } from "./compose.js";
import {
  ensureCachedSnapshot,
  parseGitSource,
  readCachedFile,
  readResolvedSource,
  resolveV2Source,
  resolveV2SourceAt,
  resolvePackageAt,
  sourceIdentity,
  sourceReference,
} from "./git.js";
import {
  assertSafeDirectoryPath,
  parseConsumerConfigBytes,
  readSourceDocument,
  validateDeclaredSources,
} from "./manifest.js";
import {
  configDirectory,
  globalAdapterPath,
  globalCanonicalPath,
  globalConfigDirectory,
  globalAgentRoot,
  registeredAgents,
  userHome,
} from "./paths.js";
import { applyTransaction, recoverTransaction, sha256 as transactionSha256, type TransactionWrite } from "./transaction.js";
import type {
  ConsumerConfigV2,
  FragmentDeclaration,
  FragmentProvenance,
  LocalFragment,
  PackManifest,
  PackMemberDeclaration,
  PackageManifest,
  PackageManifestV1,
  PackageManifestV2,
  SourceDescriptor,
  V2FragmentLock,
  V2GeneratedFileLock,
  V2LockFile,
  V2OutputConfig,
  V2OutputLock,
  V2PackageLock,
  V2PackageSelection,
  V2PackLock,
  V2PackMemberLock,
  V2PackSelection,
  LockFile,
  StateFile,
} from "./types.js";

export interface ScopePaths {
  scopeRoot: string;
  configPath: string;
  lockPath: string;
  localPath: string;
  operationLock: string;
  journalPath: string;
}

export interface V2CommandOptions {
  projectRoot: string;
  global?: boolean;
  offline?: boolean;
}

interface LoadedFragment {
  id: string;
  source: string;
  title: string;
  body: Buffer;
  hash: string;
}

interface LoadedPackage {
  id: string;
  source: SourceDescriptor;
  commit: string;
  manifest: PackageManifest;
  manifestBytes: Buffer;
  manifestHash: string;
  fragments: LoadedFragment[];
  compatibility?: "v1-canonical";
  requestedRef: string | null;
}

interface LoadedPack {
  id: string;
  selection: V2PackSelection;
  source: SourceDescriptor;
  commit: string;
  manifest: PackManifest;
  manifestBytes: Buffer;
  manifestHash: string;
  recipeHash: string;
  members: Map<string, LoadedPackage>;
  memberLocks: V2PackMemberLock[];
  outputs: PackManifest["outputs"];
}

interface LoadedState {
  config: ConsumerConfigV2;
  lock: V2LockFile;
  packages: Map<string, LoadedPackage>;
  packs: Map<string, LoadedPack>;
}

interface RenderedState extends LoadedState {
  generated: Map<string, { contents: Buffer; owners: string[]; kind: "agents" | "adapter" }>;
  localHashes: Record<string, string>;
  outputLocks: Record<string, V2OutputLock>;
}

interface ScopeRenderOptions extends V2CommandOptions {
  localOverrides?: Map<string, Buffer>;
  previousLock?: V2LockFile;
  introducedBy?: Record<string, string | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scopePaths(options: V2CommandOptions): ScopePaths {
  if (options.global) {
    const root = globalConfigDirectory();
    return {
      scopeRoot: root,
      configPath: join(root, "agents.yaml"),
      lockPath: join(root, "agents.lock"),
      localPath: join(root, "local.md"),
      operationLock: join(root, ".operation.lock"),
      journalPath: join(root, ".recovery.json"),
    };
  }
  return {
    scopeRoot: options.projectRoot,
    configPath: join(options.projectRoot, "agents.yaml"),
    lockPath: join(options.projectRoot, "agents.lock"),
    localPath: join(options.projectRoot, ".agents", "project.md"),
    operationLock: join(options.projectRoot, ".agents", ".operation.lock"),
    journalPath: join(options.projectRoot, ".agents", ".recovery.json"),
  };
}

function legacyPaths(options: V2CommandOptions): { state: string; lock: string } {
  if (options.global) {
    return { state: join(configDirectory(), "global.yaml"), lock: join(configDirectory(), "global.lock") };
  }
  return { state: join(options.projectRoot, "agents.yaml"), lock: join(options.projectRoot, "agents.lock") };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fileHash(path: string): Promise<string | null> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink target: ${path}`);
    if (!stat.isFile()) throw new Error(`Expected regular file: ${path}`);
    return sha256(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readBytes(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readConfig(paths: ScopePaths, global: boolean): Promise<ConsumerConfigV2> {
  const bytes = await readFile(paths.configPath, "utf8");
  return parseConsumerConfigBytes(bytes, global);
}

async function readLock(paths: ScopePaths): Promise<V2LockFile> {
  const value = parse(await readFile(paths.lockPath, "utf8")) as unknown;
  if (!isRecord(value) || value.version !== 2) throw new Error(`${paths.lockPath}: lock version must be 2`);
  return value as unknown as V2LockFile;
}

function emptyConfig(global: boolean, agents?: string[]): ConsumerConfigV2 {
  return {
    version: 2,
    packages: [],
    packs: [],
    outputs: [{ directory: ".", use: [], exclude: [], local: [global ? "local.md" : ".agents/project.md"], ...(global ? {} : { adapters: ["claude-code"] }) }],
    ...(global ? { agents: agents && agents.length > 0 ? agents : ["claude-code"] } : {}),
  };
}

function selectionFingerprint(config: ConsumerConfigV2): string {
  return sha256(stringify({
    packages: config.packages.map(({ id, source, ref, compatibility }) => ({ id, source, ref: ref ?? null, compatibility: compatibility ?? null })),
    packs: config.packs.map(({ id, source, ref, directory, omitOutputs }) => ({ id, source, ref: ref ?? null, directory, omitOutputs })),
  }));
}

function canonicalConfigHash(config: ConsumerConfigV2): string {
  return sha256(stringify(config));
}

function packageSelectionById(config: ConsumerConfigV2): Map<string, V2PackageSelection> {
  return new Map(config.packages.map((selection) => [selection.id, selection]));
}

function packSelectionById(config: ConsumerConfigV2): Map<string, V2PackSelection> {
  return new Map(config.packs.map((selection) => [selection.id, selection]));
}

function packageLockFor(loaded: LoadedPackage): V2PackageLock {
  return {
    id: loaded.id,
    source: loaded.source,
    requestedRef: loaded.requestedRef,
    commit: loaded.commit,
    manifestSha256: loaded.manifestHash,
    fragments: loaded.fragments.map((fragment) => ({ id: fragment.id, source: fragment.source, title: fragment.title, sha256: fragment.hash })),
    ...(loaded.compatibility ? { compatibility: loaded.compatibility } : {}),
  };
}

function memberLockFor(loaded: LoadedPackage, recipe: LoadedPack): V2PackMemberLock {
  return {
    ...packageLockFor(loaded),
    recipeSource: recipe.source.url,
    recipeCommit: recipe.commit,
    recipePath: recipe.source.path,
  };
}

function packLockFor(loaded: LoadedPack): V2PackLock {
  return {
    id: loaded.id,
    directory: loaded.selection.directory,
    source: loaded.source,
    requestedRef: loaded.selection.ref ?? null,
    commit: loaded.commit,
    manifestSha256: loaded.manifestHash,
    recipeHash: loaded.recipeHash,
    members: [...loaded.members.values()].map((member) => memberLockFor(member, loaded)),
    outputs: loaded.outputs.map((output) => ({ directory: output.directory, use: [...output.use], exclude: [...output.exclude] })),
    omitOutputs: [...loaded.selection.omitOutputs],
  };
}

function manifestFragmentDeclarations(manifest: PackageManifest): FragmentDeclaration[] {
  if (manifest.schema === 2) return manifest.fragments;
  if (!manifest.canonical) throw new Error("Legacy package has no canonical source");
  return [{ id: "canonical", source: manifest.canonical.source, title: "Canonical instructions" }];
}

function compatibleV1(manifest: PackageManifestV1): void {
  if (!manifest.canonical) throw new Error("v1-canonical package requires canonical.source");
  const canonical = manifest.files.filter((file) => file.source === manifest.canonical?.source);
  const direct = canonical.some((file) => file.targets.some((target) => target.scope === "project" && target.path === "AGENTS.md" && target.mode !== "import"));
  const claude = canonical.some((file) => file.targets.some((target) => target.scope === "project" && target.agent === "claude-code" && target.path === "CLAUDE.md" && target.mode === "import" && target.import === "AGENTS.md"));
  if (!direct || !claude) throw new Error("v1-canonical package must target project AGENTS.md and exact Claude import");
  if (manifest.files.some((file) => file.targets.some((target) => target.scope === "global" || (target.scope === "project" && target.path !== "AGENTS.md" && target.path !== "CLAUDE.md")))) {
    throw new Error("v1-canonical package contains unsupported destinations");
  }
}

async function loadPackageFromRoot(
  id: string,
  source: SourceDescriptor,
  commit: string,
  root: string,
  requestedRef: string | null,
  expected?: V2PackageLock | V2PackMemberLock,
  compatibility?: "v1-canonical",
): Promise<LoadedPackage> {
  const document = await readSourceDocument(root);
  if (document.kind !== "package") throw new Error(`Expected package at ${sourceReference(source)}, found pack`);
  if (document.manifest.schema === 1 && !compatibility) throw new Error(`Schema 1 package ${id} requires migrate before v2 installation`);
  if (document.manifest.schema === 2 && compatibility) throw new Error(`Package ${id} is no longer v1-compatible at ${commit}`);
  if (compatibility && document.manifest.schema === 1) compatibleV1(document.manifest);
  const declarations = manifestFragmentDeclarations(document.manifest);
  const manifestHash = sha256(document.bytes);
  if (expected && expected.manifestSha256 !== manifestHash) throw new Error(`Locked manifest changed for ${id}`);
  const fragments: LoadedFragment[] = [];
  for (const declaration of declarations) {
    const body = await readCachedFile(root, declaration.source);
    const bodyHash = sha256(body);
    const expectedFragment = expected?.fragments.find((fragment) => fragment.id === declaration.id);
    if (expectedFragment && (expectedFragment.sha256 !== bodyHash || expectedFragment.source !== declaration.source || expectedFragment.title !== declaration.title)) {
      throw new Error(`Locked fragment changed for ${id}/${declaration.id}`);
    }
    fragments.push({ id: declaration.id, source: declaration.source, title: declaration.title, body, hash: bodyHash });
  }
  if (expected && expected.fragments.length !== fragments.length) throw new Error(`Locked fragment list changed for ${id}`);
  return {
    id,
    source,
    commit,
    manifest: document.manifest,
    manifestBytes: document.bytes,
    manifestHash,
    fragments,
    ...(compatibility ? { compatibility } : {}),
    requestedRef,
  };
}

function memberSource(recipe: LoadedPackWithRoot, member: PackMemberDeclaration): SourceDescriptor {
  const hashIndex = member.source.indexOf("#");
  const sourcePart = hashIndex === -1 ? member.source : member.source.slice(0, hashIndex);
  const suffix = hashIndex === -1 ? "." : member.source.slice(hashIndex + 1) || ".";
  if (sourcePart.startsWith("./") || sourcePart.startsWith("../") || sourcePart === "." || sourcePart === "..") {
    const base = recipe.source.path === "." ? "." : recipe.source.path;
    const path = assertSafeDirectoryPath(join(base, sourcePart, suffix), `pack member ${member.id}.source`);
    const absolute = resolve(recipe.rootForRelative, ...path.split("/"));
    const relation = relative(recipe.rootForRelative, absolute);
    if (relation.startsWith("..")) throw new Error(`Pack member escapes repository: ${member.id}`);
    return { type: "git", url: recipe.source.url, path };
  }
  return { type: "git", url: sourcePart, path: assertSafeDirectoryPath(suffix, `pack member ${member.id}.source`) };
}

// TypeScript cannot add private fields to the public lock model; this field stays internal to a loaded recipe.
type LoadedPackWithRoot = LoadedPack & { rootForRelative: string };

async function resolvePack(
  selection: V2PackSelection,
  projectRoot: string,
  mode: "locked" | "current",
  oldLock: V2PackLock | undefined,
  offline: boolean,
): Promise<LoadedPack> {
  let resolved;
  if (mode === "locked") {
    if (!oldLock) throw new Error(`Pack is not locked: ${selection.id}`);
    resolved = await resolveV2SourceAt(oldLock.source, oldLock.commit, offline);
  } else {
    resolved = await resolveV2Source(selection.source, projectRoot, selection.ref);
  }
  const document = await readResolvedSource(resolved);
  if (document.kind !== "pack") throw new Error(`Source ${selection.id} is not a pack`);
  const manifestHash = sha256(document.bytes);
  if (mode === "locked" && oldLock && oldLock.manifestSha256 !== manifestHash) throw new Error(`Locked pack recipe changed: ${selection.id}`);
  const recipe: LoadedPackWithRoot = {
    id: selection.id,
    selection,
    source: resolved.source,
    commit: resolved.commit,
    manifest: document.manifest,
    manifestBytes: document.bytes,
    manifestHash,
    recipeHash: sha256(document.bytes),
    members: new Map(),
    memberLocks: [],
    outputs: document.manifest.outputs,
    rootForRelative: resolved.repositoryRoot,
  };
  const oldMembers = new Map((oldLock?.members ?? []).map((member) => [member.id, member]));
  const memberIds = new Set(recipe.manifest.packages.map((member) => member.id));
  for (const output of recipe.outputs) {
    for (const excluded of output.exclude) {
      const [memberId, fragmentId, ...rest] = excluded.split("/");
      if (rest.length > 0 || !memberIds.has(memberId) || !fragmentId) throw new Error(`Unknown pack exclusion in ${selection.id}/${output.directory}: ${excluded}`);
    }
  }
  for (const member of recipe.manifest.packages) {
    if ((member.source.startsWith("./") || member.source.startsWith("../") || member.source === ".") && member.ref !== undefined) {
      throw new Error(`Relative pack member cannot specify ref: ${selection.id}/${member.id}`);
    }
    const memberSourceDescriptor = memberSource(recipe, member);
    let memberResolved;
    let requestedRef: string | undefined;
    let expected: V2PackMemberLock | undefined;
    if (mode === "locked") {
      expected = oldMembers.get(member.id);
      if (!expected) throw new Error(`Pack lock missing member: ${selection.id}/${member.id}`);
      memberResolved = await resolveV2SourceAt(expected.source, expected.commit, offline);
      requestedRef = expected.requestedRef ?? undefined;
    } else if (member.source.startsWith("./") || member.source.startsWith("../") || member.source === ".") {
      memberResolved = await resolveV2SourceAt(memberSourceDescriptor, recipe.commit, offline);
    } else {
      requestedRef = member.ref;
      memberResolved = await resolveV2Source(member.source, projectRoot, member.ref);
    }
    const loaded = await loadPackageFromRoot(
      member.id,
      memberResolved.source,
      memberResolved.commit,
      memberResolved.root,
      requestedRef ?? null,
      expected,
    );
    recipe.members.set(member.id, loaded);
    recipe.memberLocks.push(memberLockFor(loaded, recipe));
  }
  return recipe;
}

async function loadLockedState(options: ScopeRenderOptions): Promise<LoadedState> {
  const paths = scopePaths(options);
  const config = await readConfig(paths, Boolean(options.global));
  const lock = await readLock(paths);
  if (lock.selectionSha256 && lock.selectionSha256 !== selectionFingerprint(config)) {
    throw new Error("Package or pack source/ref membership changed; run update before render");
  }
  const packages = new Map<string, LoadedPackage>();
  const packs = new Map<string, LoadedPack>();
  for (const selection of config.packages) {
    const locked = lock.packages[selection.id];
    if (!locked) throw new Error(`Lock is missing package: ${selection.id}`);
    const parsed = await parseGitSource(selection.source, options.projectRoot, true);
    if (sourceIdentity(parsed.source) !== sourceIdentity(locked.source) || (selection.ref ?? null) !== locked.requestedRef) {
      throw new Error(`Package source/ref changed for ${selection.id}; run update`);
    }
    const resolved = await resolveV2SourceAt(locked.source, locked.commit, Boolean(options.offline));
    packages.set(selection.id, await loadPackageFromRoot(selection.id, locked.source, locked.commit, resolved.root, locked.requestedRef, locked, locked.compatibility));
  }
  for (const selection of config.packs) {
    const locked = lock.packs[selection.id];
    if (!locked) throw new Error(`Lock is missing pack: ${selection.id}`);
    const parsed = await parseGitSource(selection.source, options.projectRoot, true);
    if (sourceIdentity(parsed.source) !== sourceIdentity(locked.source) || (selection.ref ?? null) !== locked.requestedRef || selection.directory !== locked.directory) {
      throw new Error(`Pack source/ref changed for ${selection.id}; run update`);
    }
    packs.set(selection.id, await resolvePack(selection, options.projectRoot, "locked", locked, Boolean(options.offline)));
  }
  return { config, lock, packages, packs };
}

function outputPath(output: V2OutputConfig, file: string): string {
  return output.directory === "." ? file : `${output.directory}/${file}`;
}

function localAbsolutePath(paths: ScopePaths, options: ScopeRenderOptions, local: string): string {
  return options.global ? join(paths.scopeRoot, ...local.split("/")) : join(options.projectRoot, ...local.split("/"));
}

async function localFragmentsFor(
  output: V2OutputConfig,
  paths: ScopePaths,
  options: ScopeRenderOptions,
): Promise<{ fragments: LocalFragment[]; hashes: Record<string, string> }> {
  const fragments: LocalFragment[] = [];
  const hashes: Record<string, string> = {};
  for (const local of output.local) {
    const absolute = localAbsolutePath(paths, options, local);
    const override = options.localOverrides?.get(local);
    const body = override ?? await readBytes(absolute);
    if (body === undefined) throw new Error(`Configured local fragment is missing: ${absolute}`);
    fragments.push({ path: local, body });
    hashes[local] = sha256(body);
  }
  return { fragments, hashes };
}

function appendPackageFragments(
  target: FragmentProvenance[],
  loaded: LoadedPackage,
  contributionAlias: string,
  excludes: Set<string>,
  validExclusions: Set<string>,
): void {
  for (const fragment of loaded.fragments) {
    const exclusion = `${contributionAlias}/${fragment.id}`;
    validExclusions.add(exclusion);
    if (excludes.has(exclusion)) continue;
    target.push({
      identity: `${sourceIdentity(loaded.source)}@${loaded.commit}`,
      label: `${contributionAlias}/${fragment.id} — ${fragment.title}`,
      alias: contributionAlias,
      fragmentId: fragment.id,
      title: fragment.title,
      source: loaded.source,
      commit: loaded.commit,
      body: fragment.body,
    });
  }
}

function packOutputFor(pack: LoadedPack, output: V2OutputConfig): PackManifest["outputs"][number] {
  const matches = pack.outputs.filter((recipeOutput) => {
    const mounted = pack.selection.directory === "."
      ? recipeOutput.directory
      : recipeOutput.directory === "." ? pack.selection.directory : `${pack.selection.directory}/${recipeOutput.directory}`;
    return mounted === output.directory;
  });
  if (matches.length !== 1) throw new Error(`Output ${output.directory} does not correspond to one output in pack ${pack.id}`);
  return matches[0];
}

async function renderState(state: LoadedState, options: ScopeRenderOptions): Promise<RenderedState> {
  const paths = scopePaths(options);
  const generated = new Map<string, { contents: Buffer; owners: string[]; kind: "agents" | "adapter" }>();
  const localHashes: Record<string, string> = {};
  const outputLocks: Record<string, V2OutputLock> = {};
  for (const output of state.config.outputs) {
    const fragments: FragmentProvenance[] = [];
    const excludes = new Set(output.exclude);
    const validExclusions = new Set<string>();
    for (const alias of output.use) {
      const direct = state.packages.get(alias);
      if (direct) {
        appendPackageFragments(fragments, direct, alias, excludes, validExclusions);
        continue;
      }
      const pack = state.packs.get(alias);
      if (!pack) throw new Error(`Output ${output.directory} references unknown alias: ${alias}`);
      const recipeOutput = packOutputFor(pack, output);
      for (const recipeExcluded of recipeOutput.exclude) {
        const [memberId, fragmentId] = recipeExcluded.split("/");
        excludes.add(`${pack.id}/${memberId}/${fragmentId}`);
      }
      for (const memberId of recipeOutput.use) {
        const member = pack.members.get(memberId);
        if (!member) throw new Error(`Pack ${pack.id} lock is missing member: ${memberId}`);
        appendPackageFragments(fragments, member, `${pack.id}/${memberId}`, excludes, validExclusions);
      }
    }
    for (const exclusion of output.exclude) {
      if (!validExclusions.has(exclusion)) throw new Error(`Unknown fragment exclusion in ${output.directory}: ${exclusion}`);
    }
    const local = await localFragmentsFor(output, paths, options);
    Object.assign(localHashes, local.hashes);
    const composed = compose([{ directory: output.directory, fragments, local: local.fragments }]).outputs[0];
    const agentsLogical = outputPath(output, "AGENTS.md");
    generated.set(agentsLogical, { contents: composed.body, owners: composed.fragmentOwners, kind: "agents" });
    const generatedPaths = [agentsLogical];
    for (const adapter of output.adapters ?? []) {
      if (adapter !== "claude-code") throw new Error(`No project adapter renderer is available for: ${adapter}`);
      const logical = outputPath(output, "CLAUDE.md");
      generated.set(logical, { contents: renderClaudeAdapter(), owners: composed.fragmentOwners, kind: "adapter" });
      generatedPaths.push(logical);
    }
    outputLocks[output.directory] = {
      directory: output.directory,
      use: [...output.use],
      exclude: [...output.exclude],
      local: [...output.local],
      generated: generatedPaths,
      ...(options.previousLock?.outputs[output.directory]?.introducedBy || options.introducedBy?.[output.directory]
        ? { introducedBy: options.previousLock?.outputs[output.directory]?.introducedBy ?? options.introducedBy?.[output.directory] }
        : {}),
    };
  }
  if (options.global) {
    const root = state.config.outputs.find((output) => output.directory === ".");
    if (!root) throw new Error("Global config must contain root output .");
    const shared = generated.get("AGENTS.md") ?? generated.get(outputPath(root, "AGENTS.md"));
    if (!shared) throw new Error("Global root output was not rendered");
    generated.delete("AGENTS.md");
    for (const agent of state.config.agents ?? ["claude-code"]) {
      generated.set(`${agent}/AGENTS.md`, { contents: shared.contents, owners: shared.owners, kind: "agents" });
      if (agent === "claude-code") generated.set(`${agent}/CLAUDE.md`, { contents: renderClaudeAdapter(), owners: shared.owners, kind: "adapter" });
    }
    const rootLock = outputLocks["."];
    rootLock.generated = [...generated.keys()];
  }
  return { ...state, generated, localHashes, outputLocks };
}

async function renderLoadedState(options: ScopeRenderOptions): Promise<RenderedState> {
  return renderState(await loadLockedState(options), options);
}

async function loadCurrentPackage(selection: V2PackageSelection, projectRoot: string): Promise<LoadedPackage> {
  const resolved = await resolveV2Source(selection.source, projectRoot, selection.ref);
  const document = await readResolvedSource(resolved);
  if (document.kind !== "package") throw new Error(`Source ${selection.id} is a pack; use pack selection`);
  if (document.manifest.schema !== 2) throw new Error(`Schema 1 package ${selection.id} requires migrate before v2 installation`);
  return loadPackageFromRoot(selection.id, resolved.source, resolved.commit, resolved.root, selection.ref ?? null);
}

async function loadLockedPackage(selection: V2PackageSelection, locked: V2PackageLock, offline: boolean): Promise<LoadedPackage> {
  const resolved = await resolveV2SourceAt(locked.source, locked.commit, offline);
  return loadPackageFromRoot(selection.id, locked.source, locked.commit, resolved.root, locked.requestedRef, locked, locked.compatibility);
}

async function loadStateForSelections(
  config: ConsumerConfigV2,
  oldLock: V2LockFile,
  options: ScopeRenderOptions,
  selectedPackages: Set<string>,
  selectedPacks: Set<string>,
): Promise<LoadedState> {
  const packages = new Map<string, LoadedPackage>();
  const packs = new Map<string, LoadedPack>();
  for (const selection of config.packages) {
    const locked = oldLock.packages[selection.id];
    if (selectedPackages.has(selection.id) || !locked) {
      packages.set(selection.id, await loadCurrentPackage(selection, options.projectRoot));
    } else {
      packages.set(selection.id, await loadLockedPackage(selection, locked, Boolean(options.offline)));
    }
  }
  for (const selection of config.packs) {
    const locked = oldLock.packs[selection.id];
    if (selectedPacks.has(selection.id) || !locked) {
      packs.set(selection.id, await resolvePack(selection, options.projectRoot, "current", locked, Boolean(options.offline)));
    } else {
      packs.set(selection.id, await resolvePack(selection, options.projectRoot, "locked", locked, Boolean(options.offline)));
    }
  }
  return { config, lock: oldLock, packages, packs };
}

function outputFor(config: ConsumerConfigV2, directory: string): V2OutputConfig | undefined {
  return config.outputs.find((output) => output.directory === directory);
}

function defaultLocal(directory: string, global: boolean): string[] {
  if (global) return ["local.md"];
  return [directory === "." ? ".agents/project.md" : `${directory}/.agents/project.md`];
}

function ensureOutput(config: ConsumerConfigV2, directory: string, global: boolean, introducedBy?: string): { output: V2OutputConfig; created: boolean } {
  const existing = outputFor(config, directory);
  if (existing) return { output: existing, created: false };
  if (global && directory !== ".") throw new Error("Global scope does not permit nested outputs");
  const output: V2OutputConfig = {
    directory,
    use: [],
    exclude: [],
    local: defaultLocal(directory, global),
    ...(global ? {} : { adapters: ["claude-code"] }),
  };
  config.outputs.push(output);
  return { output, created: true };
}

function mountedOutputDirectory(mount: string, recipeDirectory: string): string {
  if (mount === ".") return recipeDirectory;
  return recipeDirectory === "." ? mount : `${mount}/${recipeDirectory}`;
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

export interface AddV2Options extends ScopeRenderOptions {
  references: string[];
  ref?: string;
  id?: string;
  directory?: string;
  dryRun?: boolean;
  agents?: string[];
}

export async function addV2(options: AddV2Options): Promise<{ ids: string[]; commits: string[] }> {
  if (options.references.length === 0) throw new Error("add requires at least one source");
  if (options.id && options.references.length !== 1) throw new Error("--id applies only to one source");
  if (options.global && options.directory && options.directory !== ".") throw new Error("--dir cannot select a nested output in global scope");
  const paths = scopePaths(options);
  if (!(await fileExists(paths.configPath))) {
    await initV2({ ...options, adopt: false, agents: options.agents, dryRun: Boolean(options.dryRun) });
  }
  const configExists = await fileExists(paths.configPath);
  const config = configExists ? await readConfig(paths, Boolean(options.global)) : emptyConfig(Boolean(options.global));
  const oldLock = configExists ? await readLock(paths) : emptyLock();
  const aliases = new Set([...config.packages, ...config.packs].map((selection) => selection.id));
  const nextConfig: ConsumerConfigV2 = JSON.parse(JSON.stringify(config)) as ConsumerConfigV2;
  const newPackages: V2PackageSelection[] = [];
  const newPacks: V2PackSelection[] = [];
  const selectedPackages = new Set<string>();
  const selectedPacks = new Set<string>();
  const newPackValues = new Map<string, LoadedPack>();
  const localCreates = new Map<string, Buffer>();
  const introducedBy: Record<string, string | undefined> = {};
  const directory = assertSafeDirectoryPath(options.directory ?? ".", "--dir");
  for (const [index, reference] of options.references.entries()) {
    const resolved = await resolveV2Source(reference, options.projectRoot, options.ref);
    const document = await readResolvedSource(resolved);
    const alias = options.id ?? document.manifest.name;
    if (aliases.has(alias)) throw new Error(`Alias already exists: ${alias}; pass --id for a different alias`);
    aliases.add(alias);
    if (document.kind === "package") {
      if (document.manifest.schema !== 2) throw new Error(`Schema 1 source ${reference} requires migrate; v2 add will not write legacy targets`);
      const selection: V2PackageSelection = { id: alias, source: reference, ...(options.ref === undefined ? {} : { ref: options.ref }) };
      newPackages.push(selection);
      nextConfig.packages.push(selection);
      selectedPackages.add(alias);
      const outputInfo = ensureOutput(nextConfig, directory, Boolean(options.global));
      addUnique(outputInfo.output.use, alias);
      if (outputInfo.created) {
        for (const local of outputInfo.output.local) {
          const localAbsolute = localAbsolutePath(paths, options, local);
          if (!(await fileExists(localAbsolute))) localCreates.set(local, Buffer.alloc(0));
        }
      }
    } else {
      if (options.global && document.manifest.outputs.some((output) => output.directory !== ".")) {
        throw new Error("Global scope rejects packs with nested outputs");
      }
      const selection: V2PackSelection = {
        id: alias,
        source: reference,
        directory,
        omitOutputs: [],
        ...(options.ref === undefined ? {} : { ref: options.ref }),
      };
      const loaded = await resolvePack(selection, options.projectRoot, "current", undefined, false);
      newPacks.push(selection);
      nextConfig.packs.push(selection);
      selectedPacks.add(alias);
      newPackValues.set(alias, loaded);
      for (const recipeOutput of loaded.outputs) {
        const targetDirectory = mountedOutputDirectory(directory, recipeOutput.directory);
        const outputInfo = ensureOutput(nextConfig, targetDirectory, Boolean(options.global), alias);
        if (outputInfo.created) introducedBy[targetDirectory] = alias;
        addUnique(outputInfo.output.use, alias);
        for (const excluded of recipeOutput.exclude) addUnique(outputInfo.output.exclude, `${alias}/${excluded}`);
        if (outputInfo.created) {
          for (const local of outputInfo.output.local) {
            const localAbsolute = localAbsolutePath(paths, options, local);
            if (!(await fileExists(localAbsolute))) localCreates.set(local, Buffer.alloc(0));
          }
        }
      }
    }
    if (index < options.references.length - 1 && options.id) throw new Error("--id applies only to one source");
  }
  const state = await loadStateForSelections(nextConfig, oldLock, options, selectedPackages, selectedPacks);
  const rendered = await renderState(state, { ...options, previousLock: oldLock, localOverrides: localCreates, introducedBy });
  if (options.dryRun) {
    for (const selection of [...newPackages, ...newPacks]) console.log(`Would add ${selection.id}`);
    return { ids: [...newPackages, ...newPacks].map((selection) => selection.id), commits: [...state.packages.values(), ...state.packs.values()].map((entry) => entry.commit) };
  }
  const extraWrites: TransactionWrite[] = [];
  for (const [local, body] of localCreates) extraWrites.push({ path: localAbsolutePath(paths, options, local), contents: body, expectedSha256: null });
  await writeRenderedState({ ...options, previousLock: oldLock }, rendered, extraWrites);
  return { ids: [...newPackages, ...newPacks].map((selection) => selection.id), commits: [...newPackages.map((selection) => state.packages.get(selection.id)?.commit ?? ""), ...newPacks.map((selection) => state.packs.get(selection.id)?.commit ?? "")] };
}

export async function removeV2(options: V2CommandOptions & { ids: string[]; dryRun?: boolean }): Promise<string[]> {
  if (options.ids.length === 0) throw new Error("remove requires at least one alias");
  const paths = scopePaths(options);
  const config = await readConfig(paths, Boolean(options.global));
  const oldLock = await readLock(paths);
  const known = new Set([...config.packages, ...config.packs].map((selection) => selection.id));
  for (const id of options.ids) if (!known.has(id)) throw new Error(`Unknown package or pack alias: ${id}`);
  const removed = new Set(options.ids);
  const nextConfig = JSON.parse(JSON.stringify(config)) as ConsumerConfigV2;
  nextConfig.packages = nextConfig.packages.filter((selection) => !removed.has(selection.id));
  nextConfig.packs = nextConfig.packs.filter((selection) => !removed.has(selection.id));
  const removedDirectories = new Set<string>();
  for (const output of nextConfig.outputs) {
    output.use = output.use.filter((alias) => !removed.has(alias));
    output.exclude = output.exclude.filter((exclusion) => !options.ids.some((id) => exclusion === id || exclusion.startsWith(`${id}/`)));
    const oldOutput = oldLock.outputs[output.directory];
    if (
      output.directory !== "." &&
      oldOutput?.introducedBy &&
      removed.has(oldOutput.introducedBy) &&
      output.use.length === 0 &&
      output.local.length === 1 &&
      (await fileHash(localAbsolutePath(paths, options, output.local[0]))) === sha256(Buffer.alloc(0))
    ) {
      removedDirectories.add(output.directory);
    }
  }
  nextConfig.outputs = nextConfig.outputs.filter((output) => !removedDirectories.has(output.directory));
  const state = await loadStateForSelections(nextConfig, oldLock, options, new Set(), new Set());
  const rendered = await renderState(state, { ...options, previousLock: oldLock });
  if (options.dryRun) {
    for (const id of options.ids) console.log(`Would remove ${id}`);
    return options.ids;
  }
  await writeRenderedState({ ...options, previousLock: oldLock }, rendered);
  return options.ids;
}

export async function renderV2(options: ScopeRenderOptions): Promise<void> {
  const paths = scopePaths(options);
  await recoverTransaction(paths.journalPath);
  const lock = await readLock(paths);
  const rendered = await renderLoadedState({ ...options, previousLock: lock });
  await writeRenderedState({ ...options, previousLock: lock }, rendered);
}

export async function checkV2(options: V2CommandOptions): Promise<void> {
  const paths = scopePaths(options);
  await recoverTransaction(paths.journalPath);
  const config = await readConfig(paths, Boolean(options.global));
  const lock = await readLock(paths);
  if (lock.rendererVersion !== RENDERER_VERSION) throw new Error(`Unsupported renderer version in lock: ${lock.rendererVersion}`);
  if (lock.configSha256 !== canonicalConfigHash(config)) throw new Error("Configuration changed since last render; run agents.md render");
  if (lock.selectionSha256 && lock.selectionSha256 !== selectionFingerprint(config)) throw new Error("Package or pack source/ref membership changed; run agents.md update");
  const rendered = await renderLoadedState({ ...options, previousLock: lock });
  for (const [local, expected] of Object.entries(lock.localFiles)) {
    const actual = await fileHash(localAbsolutePath(paths, options, local));
    if (actual !== expected) throw new Error(`Local fragment drift detected: ${local}; run agents.md edit or render`);
  }
  const expectedGenerated = Object.keys(lock.generatedFiles).sort();
  const plannedGenerated = [...rendered.generated.keys()].sort();
  if (JSON.stringify(expectedGenerated) !== JSON.stringify(plannedGenerated)) throw new Error("Generated file ownership differs from lock; run agents.md render");
  for (const [logical, generated] of rendered.generated) {
    const actual = await fileHash(logicalDestination(options, logical));
    if (actual !== sha256(generated.contents)) throw new Error(`Generated file drift detected: ${logical}; run agents.md render`);
  }
}

function oneHunkDiff(oldBody: Buffer | undefined, newBody: Buffer): string {
  const oldText = oldBody?.toString("utf8") ?? "";
  const newText = newBody.toString("utf8");
  if (oldText === newText) return "";
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1;
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);
  const oldStart = prefix + 1;
  const newStart = prefix + 1;
  const lines = [`@@ -${oldStart},${oldMiddle.length} +${newStart},${newMiddle.length} @@`];
  for (const line of oldMiddle) lines.push(`-${line}`);
  for (const line of newMiddle) lines.push(`+${line}`);
  return lines.join("\n") + "\n";
}

async function plannedRenderedForDiff(options: ScopeRenderOptions, update: boolean): Promise<RenderedState> {
  const paths = scopePaths(options);
  const config = await readConfig(paths, Boolean(options.global));
  const lock = await readLock(paths);
  if (!update) return renderLoadedState({ ...options, previousLock: lock });
  const selectedPackages = new Set(config.packages.map((selection) => selection.id));
  const selectedPacks = new Set(config.packs.map((selection) => selection.id));
  const state = await loadStateForSelections(config, lock, options, selectedPackages, selectedPacks);
  return renderState(state, { ...options, previousLock: lock });
}

export async function diffV2(options: ScopeRenderOptions & { update?: boolean }): Promise<void> {
  const rendered = await plannedRenderedForDiff(options, Boolean(options.update));
  const oldLock = rendered.lock;
  for (const [logical, generated] of rendered.generated) {
    const current = await readBytes(logicalDestination(options, logical));
    const diff = oneHunkDiff(current, generated.contents);
    if (diff) {
      console.log(`--- ${logical}`);
      console.log(`+++ ${logical} (planned)`);
      process.stdout.write(diff);
    }
  }
  if (options.update) {
    for (const [id, packageValue] of rendered.packages) {
      const previous = oldLock.packages[id];
      if (previous && previous.commit !== packageValue.commit) console.log(`package ${id}: ${previous.commit} ${packageValue.commit}`);
    }
    for (const [id, pack] of rendered.packs) {
      const previous = oldLock.packs[id];
      if (previous && previous.commit !== pack.commit) console.log(`pack ${id}: ${previous.commit} ${pack.commit}`);
      for (const member of pack.memberLocks) {
        const oldMember = previous?.members.find((candidate) => candidate.id === member.id);
        if (oldMember && oldMember.commit !== member.commit) console.log(`pack ${id}/${member.id}: ${oldMember.commit} ${member.commit}`);
      }
    }
  }
}

function sourceMatchesLock(selection: V2PackageSelection | V2PackSelection, locked: V2PackageLock | V2PackLock, projectRoot: string): Promise<boolean> {
  return parseGitSource(selection.source, projectRoot, true).then((parsed) =>
    sourceIdentity(parsed.source) === sourceIdentity(locked.source) &&
    (selection.ref ?? null) === locked.requestedRef &&
    ("directory" in selection ? selection.directory === (locked as V2PackLock).directory : true),
  );
}

async function assertFilteredUpdateStable(config: ConsumerConfigV2, lock: V2LockFile, selected: Set<string>, options: V2CommandOptions): Promise<void> {
  for (const selection of config.packages) {
    if (selected.has(selection.id)) continue;
    const locked = lock.packages[selection.id];
    if (!locked || !(await sourceMatchesLock(selection, locked, options.projectRoot))) throw new Error(`Filtered update found unrelated unresolved package changes: ${selection.id}`);
  }
  for (const selection of config.packs) {
    if (selected.has(selection.id)) continue;
    const locked = lock.packs[selection.id];
    if (!locked || !(await sourceMatchesLock(selection, locked, options.projectRoot))) throw new Error(`Filtered update found unrelated unresolved pack changes: ${selection.id}`);
  }
}

function reconcilePackOutputs(
  config: ConsumerConfigV2,
  oldConfig: ConsumerConfigV2,
  oldLock: V2LockFile,
  packs: Map<string, LoadedPack>,
  options: V2CommandOptions,
): { localCreates: Map<string, Buffer>; introducedBy: Record<string, string | undefined> } {
  const localCreates = new Map<string, Buffer>();
  const introducedBy: Record<string, string | undefined> = {};
  for (const [packId, pack] of packs) {
    const selection = config.packs.find((candidate) => candidate.id === packId);
    if (!selection) continue;
    const oldPack = oldLock.packs[packId];
    const oldRecipeDirs = new Set((oldPack?.outputs ?? []).map((output) => output.directory));
    const newRecipeDirs = new Set(pack.outputs.map((output) => output.directory));
    for (const recipeOutput of pack.outputs) {
      const targetDirectory = mountedOutputDirectory(selection.directory, recipeOutput.directory);
      const omitted = selection.omitOutputs.includes(recipeOutput.directory);
      let output = outputFor(config, targetDirectory);
      if (!output && !omitted) {
        output = ensureOutput(config, targetDirectory, Boolean(options.global), packId).output;
        introducedBy[targetDirectory] = packId;
        for (const local of output.local) localCreates.set(local, Buffer.alloc(0));
      }
      if (!output) continue;
      const previousUse = oldConfig.outputs.find((candidate) => candidate.directory === targetDirectory)?.use.includes(packId) ?? false;
      if (previousUse && !output.use.includes(packId) && !selection.omitOutputs.includes(recipeOutput.directory)) {
        selection.omitOutputs.push(recipeOutput.directory);
      }
      output.exclude = output.exclude.filter((exclusion) => !exclusion.startsWith(`${packId}/`));
      if (!selection.omitOutputs.includes(recipeOutput.directory)) {
        addUnique(output.use, packId);
        for (const excluded of recipeOutput.exclude) addUnique(output.exclude, `${packId}/${excluded}`);
      } else {
        output.use = output.use.filter((alias) => alias !== packId);
      }
    }
    for (const oldDirectory of oldRecipeDirs) {
      if (newRecipeDirs.has(oldDirectory)) continue;
      const targetDirectory = mountedOutputDirectory(selection.directory, oldDirectory);
      const output = outputFor(config, targetDirectory);
      if (!output) continue;
      output.use = output.use.filter((alias) => alias !== packId);
      output.exclude = output.exclude.filter((exclusion) => !exclusion.startsWith(`${packId}/`));
    }
  }
  return { localCreates, introducedBy };
}

export async function updateV2(options: V2CommandOptions & { ids?: string[]; dryRun?: boolean }): Promise<void> {
  const paths = scopePaths(options);
  const oldConfig = await readConfig(paths, Boolean(options.global));
  const oldLock = await readLock(paths);
  const requested = options.ids ?? [];
  const allIds = new Set([...oldConfig.packages, ...oldConfig.packs].map((selection) => selection.id));
  for (const id of requested) if (!allIds.has(id)) throw new Error(`Unknown package or pack alias: ${id}`);
  const selected = requested.length === 0 ? allIds : new Set(requested);
  if (requested.length > 0) await assertFilteredUpdateStable(oldConfig, oldLock, selected, options);
  const nextConfig = JSON.parse(JSON.stringify(oldConfig)) as ConsumerConfigV2;
  const selectedPackages = new Set(nextConfig.packages.filter((selection) => selected.has(selection.id)).map((selection) => selection.id));
  const selectedPacks = new Set(nextConfig.packs.filter((selection) => selected.has(selection.id)).map((selection) => selection.id));
  const preliminary = await loadStateForSelections(nextConfig, oldLock, options, selectedPackages, selectedPacks);
  const reconciliation = reconcilePackOutputs(nextConfig, oldConfig, oldLock, preliminary.packs, options);
  const state = await loadStateForSelections(nextConfig, oldLock, options, selectedPackages, selectedPacks);
  const identities = new Map<string, { commit: string; selected: boolean; label: string }>();
  for (const selection of nextConfig.packages) {
    const loaded = state.packages.get(selection.id);
    if (!loaded) continue;
    const identity = sourceIdentity(loaded.source);
    const previous = identities.get(identity);
    if (previous && previous.commit !== loaded.commit) throw new Error(`Conflicting revisions for shared source ${identity}`);
    identities.set(identity, { commit: loaded.commit, selected: selected.has(selection.id), label: selection.id });
  }
  for (const [packId, pack] of state.packs) {
    for (const member of pack.members.values()) {
      const identity = sourceIdentity(member.source);
      const previous = identities.get(identity);
      if (previous && previous.commit !== member.commit) throw new Error(`Conflicting revisions for shared source ${identity} (${previous.label} vs ${packId})`);
      identities.set(identity, { commit: member.commit, selected: selected.has(packId), label: `${packId}/${member.id}` });
    }
  }
  const rendered = await renderState(state, { ...options, previousLock: oldLock, localOverrides: reconciliation.localCreates, introducedBy: reconciliation.introducedBy });
  if (options.dryRun) {
    console.log(`Would update ${[...selected].join(", ")}`);
    return;
  }
  const extraWrites: TransactionWrite[] = [];
  for (const [local, body] of reconciliation.localCreates) {
    const absolute = localAbsolutePath(paths, options, local);
    if (!(await fileExists(absolute))) extraWrites.push({ path: absolute, contents: body, expectedSha256: null });
  }
  await writeRenderedState({ ...options, previousLock: oldLock }, rendered, extraWrites);
}

export async function outdatedV2(options: V2CommandOptions): Promise<boolean> {
  const paths = scopePaths(options);
  const config = await readConfig(paths, Boolean(options.global));
  const lock = await readLock(paths);
  let outdated = false;
  for (const selection of config.packages) {
    const old = lock.packages[selection.id];
    if (!old) throw new Error(`Lock is missing package: ${selection.id}`);
    const current = await loadCurrentPackage(selection, options.projectRoot);
    if (current.commit !== old.commit) {
      console.log(`package ${selection.id}: ${old.commit} ${current.commit}`);
      outdated = true;
    }
  }
  for (const selection of config.packs) {
    const old = lock.packs[selection.id];
    const current = await resolvePack(selection, options.projectRoot, "current", old, false);
    if (current.commit !== old.commit) {
      console.log(`pack ${selection.id}: ${old.commit} ${current.commit}`);
      outdated = true;
    }
    for (const member of current.memberLocks) {
      const previous = old.members.find((candidate) => candidate.id === member.id);
      if (!previous || previous.commit !== member.commit) {
        console.log(`pack ${selection.id}/${member.id}: ${previous?.commit ?? "missing"} ${member.commit}`);
        outdated = true;
      }
    }
  }
  return outdated;
}

function splitEditorCommand(value: string): string[] {
  const result: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s]+)/g;
  for (const match of value.matchAll(pattern)) result.push(match[1] ?? match[2] ?? match[3]);
  return result;
}

async function runEditor(command: string, path: string): Promise<void> {
  const parts = splitEditorCommand(command);
  if (parts.length === 0) throw new Error("Editor command is empty");
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(parts[0], [...parts.slice(1), path], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Editor failed${signal ? ` with ${signal}` : ` with exit code ${code ?? "unknown"}`}`));
    });
  });
}

export async function editV2(options: V2CommandOptions & { directory?: string }): Promise<{ path: string; edited: boolean }> {
  const paths = scopePaths(options);
  const config = await readConfig(paths, Boolean(options.global));
  const directory = assertSafeDirectoryPath(options.directory ?? ".", "--dir");
  const output = config.outputs.find((candidate) => candidate.directory === directory);
  if (!output) throw new Error(`No configured output directory: ${directory}`);
  const local = output.local[0] ?? defaultLocal(directory, Boolean(options.global))[0];
  const absolute = localAbsolutePath(paths, options, local);
  if (!(await fileExists(absolute))) {
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, "", "utf8");
  }
  const editor = process.env.VISUAL ?? process.env.EDITOR;
  if (!editor) {
    console.log(`Edit ${absolute}, then run agents.md render`);
    return { path: absolute, edited: false };
  }
  await runEditor(editor, absolute);
  await renderV2(options);
  return { path: absolute, edited: true };
}

function migratedSource(source: SourceDescriptor): string {
  const url = source.url.startsWith("/") ? `file://${source.url}` : source.url;
  return source.path === "." ? url : `${url}#${source.path}`;
}

function parseLegacyState(value: unknown, path: string): StateFile {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.packages)) throw new Error(`Unsupported legacy state: ${path}`);
  return value as unknown as StateFile;
}

function parseLegacyLock(value: unknown, path: string): LockFile {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.packages)) throw new Error(`Unsupported legacy lock: ${path}`);
  return value as unknown as LockFile;
}

export async function migrateV1(options: V2CommandOptions & { dryRun?: boolean }): Promise<void> {
  if (options.global) throw new Error("Global legacy migration is unsupported; create a global v2 scope and adopt guidance manually");
  const oldPaths = legacyPaths(options);
  const paths = scopePaths(options);
  if (await fileExists(paths.configPath)) throw new Error("Project already has a v2 agents.yaml");
  if (!(await fileExists(oldPaths.state)) || !(await fileExists(oldPaths.lock))) throw new Error("No complete legacy project state found to migrate");
  const state = parseLegacyState(parse(await readFile(oldPaths.state, "utf8")), oldPaths.state);
  const oldLock = parseLegacyLock(parse(await readFile(oldPaths.lock, "utf8")), oldPaths.lock);
  if (await fileExists(join(configDirectory(), "global.yaml")) || await fileExists(join(configDirectory(), "global.lock"))) {
    throw new Error("Mixed or global legacy state is unsupported; use the manual migration recipe");
  }
  if (await fileExists(paths.localPath)) throw new Error(`Pre-existing local input blocks migration: ${paths.localPath}`);
  const owners = new Map<string, string>();
  const packages: V2PackageSelection[] = [];
  const packageLocks: Record<string, V2PackageLock> = {};
  for (const reference of state.packages) {
    const locked = oldLock.packages[reference.id];
    if (!locked || locked.scope !== "project") throw new Error(`Legacy package lacks project lock: ${reference.id}`);
    const targets = locked.files.filter((file) => file.scope === "project");
    const canonical = targets.find((file) => file.path === "AGENTS.md" && file.mode !== "import");
    const adapter = targets.find((file) => file.path === "CLAUDE.md" && file.mode === "import");
    if (!canonical || !adapter || targets.some((file) => file.path !== "AGENTS.md" && file.path !== "CLAUDE.md")) {
      throw new Error(`Legacy package ${reference.id} has unsupported destinations; use manual migration recipe`);
    }
    for (const file of targets) {
      const previous = owners.get(file.path);
      if (previous) throw new Error(`Multiple legacy owners of ${file.path}: ${previous}, ${reference.id}`);
      owners.set(file.path, reference.id);
    }
    const resolved = await resolvePackageAt(locked.source, locked.commit);
    compatibleV1(resolved.manifest);
    const canonicalSource = resolved.manifest.canonical?.source;
    if (!canonicalSource) throw new Error(`Legacy package has no canonical source: ${reference.id}`);
    const body = await readFile(join(resolved.root, canonicalSource));
    if (sha256(body) !== canonical.sha256) throw new Error(`Legacy lock content does not match source: ${reference.id}`);
    packages.push({ id: reference.id, source: migratedSource(locked.source) });
    packageLocks[reference.id] = {
      id: reference.id,
      source: locked.source,
      requestedRef: null,
      commit: locked.commit,
      manifestSha256: locked.manifestSha256,
      fragments: [{ id: "canonical", source: canonicalSource, title: "Canonical instructions", sha256: sha256(body) }],
      compatibility: "v1-canonical",
    };
  }
  const currentAgents = await existingCanonical(join(options.projectRoot, "AGENTS.md"));
  if (!currentAgents || currentAgents.length === 0) throw new Error("Legacy AGENTS.md is missing; preserve it before migration");
  const canonicalLock = oldLock.packages[state.packages[0]?.id ?? ""]?.files.find((file) => file.path === "AGENTS.md");
  if (!canonicalLock || sha256(currentAgents) !== canonicalLock.sha256) throw new Error("Existing AGENTS.md has edits; save them in a local fragment before migration");
  const currentClaude = await existingCanonical(join(options.projectRoot, "CLAUDE.md"));
  if (currentClaude !== undefined && !currentClaude.equals(renderClaudeAdapter())) throw new Error("Custom CLAUDE.md must be reconciled before migration");
  const config: ConsumerConfigV2 = {
    version: 2,
    packages,
    packs: [],
    outputs: [{ directory: ".", use: packages.map((selection) => selection.id), exclude: [], local: [".agents/project.md"], adapters: ["claude-code"] }],
  };
  const lock: V2LockFile = {
    ...emptyLock(),
    packages: packageLocks,
    configSha256: canonicalConfigHash(config),
    selectionSha256: selectionFingerprint(config),
  };
  const stateForRender = await loadStateForSelections(config, lock, { ...options, previousLock: lock }, new Set(), new Set());
  const rendered = await renderState(stateForRender, { ...options, previousLock: lock, localOverrides: new Map([[".agents/project.md", Buffer.alloc(0)]]) });
  const migrationOldLock: V2LockFile = {
    ...emptyLock(),
    generatedFiles: {
      "AGENTS.md": { sha256: sha256(currentAgents), owners: [], kind: "agents" },
      "CLAUDE.md": { sha256: currentClaude ? sha256(currentClaude) : sha256(renderClaudeAdapter()), owners: [], kind: "adapter" },
    },
  };
  if (options.dryRun) {
    console.log("Would migrate legacy project state to v2");
    return;
  }
  const extra: TransactionWrite[] = [
    { path: paths.localPath, contents: Buffer.alloc(0), expectedSha256: null },
    { path: join(options.projectRoot, ".agents", "adopted", "AGENTS.md"), contents: currentAgents, expectedSha256: null },
  ];
  await writeRenderedState({ ...options, previousLock: migrationOldLock }, rendered, extra);
}





function lockFromRendered(rendered: RenderedState): V2LockFile {
  const generatedFiles: Record<string, V2GeneratedFileLock> = {};
  const ownership: Record<string, string[]> = {};
  for (const [path, generated] of rendered.generated) {
    generatedFiles[path] = { sha256: sha256(generated.contents), owners: [...generated.owners], kind: generated.kind };
    ownership[path] = [...generated.owners];
  }
  return {
    version: 2,
    rendererVersion: RENDERER_VERSION,
    configSha256: canonicalConfigHash(rendered.config),
    selectionSha256: selectionFingerprint(rendered.config),
    packages: Object.fromEntries([...rendered.packages].map(([id, packageValue]) => [id, packageLockFor(packageValue)])),
    packs: Object.fromEntries([...rendered.packs].map(([id, pack]) => [id, packLockFor(pack)])),
    localFiles: { ...rendered.localHashes },
    generatedFiles,
    ownership,
    outputs: rendered.outputLocks,
  };
}

function globalLogicalDestination(logical: string): string {
  const [agent, ...parts] = logical.split("/");
  if (parts.join("/") === "AGENTS.md") return globalCanonicalPath(agent);
  if (parts.join("/") === "CLAUDE.md") {
    const destination = globalAdapterPath(agent);
    if (!destination) throw new Error(`Global agent has no Claude adapter: ${agent}`);
    return destination;
  }
  throw new Error(`Unknown global generated path: ${logical}`);
}

function projectLogicalDestination(projectRoot: string, logical: string): string {
  return join(projectRoot, ...logical.split("/"));
}

function logicalDestination(options: V2CommandOptions, logical: string): string {
  return options.global ? globalLogicalDestination(logical) : projectLogicalDestination(options.projectRoot, logical);
}

async function writeRenderedState(
  options: ScopeRenderOptions,
  rendered: RenderedState,
  extraWrites: TransactionWrite[] = [],
): Promise<V2LockFile> {
  const paths = scopePaths(options);
  const nextLock = lockFromRendered(rendered);
  const oldLock = options.previousLock ?? rendered.lock;
  const writes: TransactionWrite[] = [...extraWrites];
  const plannedPaths = new Set<string>();
  for (const [logical, generated] of rendered.generated) {
    const destination = logicalDestination(options, logical);
    plannedPaths.add(destination);
    writes.push({ path: destination, contents: generated.contents, expectedSha256: oldLock.generatedFiles[logical]?.sha256 });
  }
  for (const logical of Object.keys(oldLock.generatedFiles)) {
    if (rendered.generated.has(logical)) continue;
    writes.push({ path: logicalDestination(options, logical), contents: undefined, expectedSha256: oldLock.generatedFiles[logical].sha256 });
  }
  const configBytes = Buffer.from(stringify(rendered.config), "utf8");
  const lockBytes = Buffer.from(stringify(nextLock), "utf8");
  writes.push({ path: paths.configPath, contents: configBytes, expectedSha256: await fileHash(paths.configPath) });
  writes.push({ path: paths.lockPath, contents: lockBytes, expectedSha256: await fileHash(paths.lockPath) });
  await applyTransaction({
    writes,
    lockPath: paths.operationLock,
    journalPath: paths.journalPath,
    boundary: options.global ? userHome() : options.projectRoot,
    extraBoundaries: options.global ? [paths.scopeRoot] : undefined,
  });
  return nextLock;
}

async function checkExistingGenerated(oldLock: V2LockFile, options: V2CommandOptions): Promise<void> {
  for (const [logical, entry] of Object.entries(oldLock.generatedFiles)) {
    const actual = await fileHash(logicalDestination(options, logical));
    if (actual !== entry.sha256) throw new Error(`Generated file drift detected: ${logical}; preserve edits in a local fragment`);
  }
}

function emptyLock(): V2LockFile {
  return {
    version: 2,
    rendererVersion: RENDERER_VERSION,
    configSha256: "",
    selectionSha256: selectionFingerprint(emptyConfig(false)),
    packages: {},
    packs: {},
    localFiles: {},
    generatedFiles: {},
    ownership: {},
    outputs: {},
  };
}

function emptyRendered(config: ConsumerConfigV2, global: boolean, localBody: Buffer): RenderedState {
  const localPath = global ? "local.md" : ".agents/project.md";
  const composed = compose([{ directory: ".", fragments: [], local: [{ path: localPath, body: localBody }] }]).outputs[0];
  const generated = new Map<string, { contents: Buffer; owners: string[]; kind: "agents" | "adapter" }>();
  const outputLocks: Record<string, V2OutputLock> = {
    ".": { directory: ".", use: [], exclude: [], local: [localPath], generated: [] },
  };
  if (global) {
    for (const agent of config.agents ?? ["claude-code"]) {
      generated.set(`${agent}/AGENTS.md`, { contents: composed.body, owners: composed.fragmentOwners, kind: "agents" });
      outputLocks["."].generated.push(`${agent}/AGENTS.md`);
      if (agent === "claude-code") {
        generated.set(`${agent}/CLAUDE.md`, { contents: renderClaudeAdapter(), owners: [], kind: "adapter" });
        outputLocks["."].generated.push(`${agent}/CLAUDE.md`);
      }
    }
  } else {
    generated.set("AGENTS.md", { contents: composed.body, owners: composed.fragmentOwners, kind: "agents" });
    outputLocks["."].generated.push("AGENTS.md");
    generated.set("CLAUDE.md", { contents: renderClaudeAdapter(), owners: [], kind: "adapter" });
    outputLocks["."].generated.push("CLAUDE.md");
  }
  return {
    config,
    lock: emptyLock(),
    packages: new Map(),
    packs: new Map(),
    generated,
    localHashes: { [localPath]: sha256(localBody) },
    outputLocks,
  };
}

async function assertNoLegacyScope(options: V2CommandOptions): Promise<void> {
  const paths = scopePaths(options);
  const legacy = legacyPaths(options);
  if (await fileExists(paths.configPath)) {
    try {
      const value = parse(await readFile(paths.configPath, "utf8")) as unknown;
      if (isRecord(value) && value.version === 1) throw new Error("Legacy agents.yaml found; run agents.md migrate before v2 commands");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Legacy agents.yaml")) throw error;
    }
  }
  if (await fileExists(legacy.lock) && !await fileExists(paths.lockPath)) {
    throw new Error("Legacy lockfile found; run agents.md migrate before v2 commands");
  }
}

async function existingCanonical(path: string): Promise<Buffer | undefined> {
  const bytes = await readBytes(path);
  if (bytes === undefined) return undefined;
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlink guidance file: ${path}`);
  return bytes;
}

export async function initV2(options: V2CommandOptions & { adopt?: boolean; agents?: string[]; dryRun?: boolean }): Promise<{ created: boolean; paths: string[] }> {
  const paths = scopePaths(options);
  await recoverTransaction(paths.journalPath);
  if (await fileExists(paths.configPath)) {
    const config = await readConfig(paths, Boolean(options.global));
    await readLock(paths);
    if (options.dryRun) console.log("Already initialized");
    return { created: false, paths: [paths.configPath, paths.lockPath] };
  }
  const legacy = legacyPaths(options);
  if (await fileExists(legacy.state)) throw new Error("Legacy state exists; run agents.md migrate or use init --adopt after review");
  if (await fileExists(paths.lockPath)) throw new Error(`Refusing orphan lockfile: ${paths.lockPath}`);
  const config = emptyConfig(Boolean(options.global), options.agents);
  if (options.global && options.agents?.some((agent) => !registeredAgents().includes(agent))) {
    throw new Error(`Unknown global agent; registered agents: ${registeredAgents().join(", ")}`);
  }
  const localDestination = paths.localPath;
  if (await fileExists(localDestination)) throw new Error(`Refusing pre-existing local destination: ${localDestination}`);
  const localCanonical = options.global ? undefined : await existingCanonical(join(options.projectRoot, "AGENTS.md"));
  const localBody = localCanonical ?? Buffer.alloc(0);
  const backupPath = options.global ? join(paths.scopeRoot, "adopted", "AGENTS.md") : join(options.projectRoot, ".agents", "adopted", "AGENTS.md");
  if (!options.adopt && localCanonical !== undefined) throw new Error(`Existing AGENTS.md requires init --adopt: ${join(options.projectRoot, "AGENTS.md")}`);
  if (!options.global) {
    const claude = await existingCanonical(join(options.projectRoot, "CLAUDE.md"));
    if (claude !== undefined && !claude.equals(renderClaudeAdapter())) {
      throw new Error("Existing custom CLAUDE.md must be reconciled before init --adopt");
    }
  } else {
    const canonicalBytes: Buffer[] = [];
    for (const agent of config.agents ?? ["claude-code"]) {
      const current = await existingCanonical(globalCanonicalPath(agent));
      if (current !== undefined) canonicalBytes.push(current);
      const adapter = globalAdapterPath(agent);
      if (adapter) {
        const adapterBytes = await existingCanonical(adapter);
        if (adapterBytes !== undefined && !adapterBytes.equals(renderClaudeAdapter())) throw new Error(`Existing custom Claude adapter must be reconciled: ${adapter}`);
      }
    }
    if (canonicalBytes.length > 0) {
      const first = canonicalBytes[0];
      if (canonicalBytes.some((bytes) => !bytes.equals(first))) throw new Error("Existing global canonical files differ; reconcile them before init --global --adopt");
      if (!options.adopt) throw new Error("Existing global guidance requires init --global --adopt");
      if (!first.equals(localBody)) throw new Error("Existing global canonical files differ from adoption source");
    }
  }
  const rendered = emptyRendered(config, Boolean(options.global), localBody);
  const extraWrites: TransactionWrite[] = [{ path: localDestination, contents: localBody, expectedSha256: null }];
  if (options.adopt && localCanonical !== undefined) extraWrites.push({ path: backupPath, contents: localCanonical, expectedSha256: null });
  if (options.dryRun) {
    console.log(`Would initialize ${options.global ? "global" : "project"} scope`);
    return { created: true, paths: [paths.configPath, paths.lockPath, localDestination] };
  }
  await writeRenderedState({ ...options, previousLock: emptyLock() }, rendered, extraWrites);
  return { created: true, paths: [paths.configPath, paths.lockPath, localDestination] };
}
