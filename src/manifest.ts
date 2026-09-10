import { access, lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, normalize, posix, win32 } from "node:path";
import { parse } from "yaml";
import type {
  FragmentDeclaration,
  PackageFile,
  PackageManifest,
  PackageManifestV1,
  PackageManifestV2,
  PackageTarget,
  PackManifest,
  PackMemberDeclaration,
  PackOutputDeclaration,
  ConsumerConfigV2,
  V2OutputConfig,
  V2PackageSelection,
  V2PackSelection,
  Scope,
  SourceKind,
  TargetMode,
} from "./types.js";

const scopes = new Set<Scope>(["project", "global"]);
const modes = new Set<TargetMode>(["direct", "import", "copy"]);
const knownAgents = new Set(["claude-code", "codex", "cursor", "github-copilot", "gemini-cli"]);
const fragmentIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownFields(raw: Record<string, unknown>, allowed: Set<string>, prefix: string): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new Error(`${prefix}: unknown field ${key}`);
    }
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

export function assertSafeRelativePath(value: unknown, field: string): string {
  const path = requiredString(value, field);
  const normalizedSeparators = path.replaceAll("\\", "/");
  if (
    isAbsolute(path) ||
    posix.isAbsolute(normalizedSeparators) ||
    win32.isAbsolute(path) ||
    /^[A-Za-z]:\//.test(normalizedSeparators) ||
    normalizedSeparators.split("/").includes("..") ||
    normalizedSeparators === "." ||
    normalizedSeparators.includes("\0")
  ) {
    throw new Error(`${field} must be a safe relative path`);
  }
  return normalizedSeparators;
}

export function assertSafeDirectoryPath(value: unknown, field: string): string {
  const path = requiredString(value, field);
  const normalizedSeparators = path.replaceAll("\\", "/");
  if (
    isAbsolute(path) ||
    posix.isAbsolute(normalizedSeparators) ||
    win32.isAbsolute(path) ||
    /^[A-Za-z]:\//.test(normalizedSeparators) ||
    normalizedSeparators.split("/").includes("..") ||
    normalizedSeparators.includes("\0")
  ) {
    throw new Error(`${field} must be a safe relative directory`);
  }
  if (normalizedSeparators === "" || normalizedSeparators === ".") {
    return ".";
  }
  const normalized = posix.normalize(normalizedSeparators);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${field} must be a safe relative directory`);
  }
  return normalized;
}

export function assertValidRef(value: unknown, field: string): string {
  const ref = requiredString(value, field);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/@+\-]*$/.test(ref) ||
    ref.startsWith("-") ||
    /\s/.test(ref) ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.includes("//") ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.endsWith(".lock")
  ) {
    throw new Error(`${field} must be a valid Git ref`);
  }
  return ref;
}

function parseTarget(raw: unknown, index: number): PackageTarget {
  if (!isRecord(raw)) {
    throw new Error(`agent.yaml: files target ${index} must be an object`);
  }
  unknownFields(raw, new Set(["scope", "agent", "path", "mode", "import"]), `agent.yaml: files target ${index}`);

  const rawScope = requiredString(raw.scope, `agent.yaml: files target ${index}.scope`) as Scope;
  if (!scopes.has(rawScope)) {
    throw new Error(`agent.yaml: files target ${index}.scope must be project or global`);
  }
  const agent = raw.agent === undefined ? undefined : requiredString(raw.agent, `agent.yaml: files target ${index}.agent`);
  if (agent !== undefined && !knownAgents.has(agent)) {
    throw new Error(`agent.yaml: files target ${index}.agent is not a registered agent: ${agent}`);
  }
  if (rawScope === "global" && agent === undefined) {
    throw new Error(`agent.yaml: global files target ${index} requires agent`);
  }
  const mode = (raw.mode === undefined ? "direct" : requiredString(raw.mode, `agent.yaml: files target ${index}.mode`)) as TargetMode;
  if (!modes.has(mode)) {
    throw new Error(`agent.yaml: files target ${index}.mode must be direct, import, or copy`);
  }
  const target: PackageTarget = {
    scope: rawScope,
    ...(agent === undefined ? {} : { agent }),
    path: assertSafeRelativePath(raw.path, `agent.yaml: files target ${index}.path`),
    mode,
  };
  if (mode === "import") {
    if (agent !== "claude-code") {
      throw new Error(`agent.yaml: import mode is only supported for claude-code`);
    }
    target.import = assertSafeRelativePath(raw.import, `agent.yaml: files target ${index}.import`);
  } else if (raw.import !== undefined) {
    throw new Error(`agent.yaml: files target ${index}.import is only valid for import mode`);
  }
  return target;
}

function parseFiles(raw: unknown): PackageFile[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("agent.yaml: files must be a non-empty array");
  }
  return raw.map((entry, fileIndex) => {
    if (typeof entry === "string") {
      const source = assertSafeRelativePath(entry, `agent.yaml: files[${fileIndex}]`);
      return { source, targets: [{ scope: "project", path: source, mode: "direct" }] };
    }
    if (!isRecord(entry)) {
      throw new Error(`agent.yaml: files[${fileIndex}] must be a string or object`);
    }
    unknownFields(entry, new Set(["source", "targets"]), `agent.yaml: files[${fileIndex}]`);
    const source = assertSafeRelativePath(entry.source, `agent.yaml: files[${fileIndex}].source`);
    if (!Array.isArray(entry.targets) || entry.targets.length === 0) {
      throw new Error(`agent.yaml: files[${fileIndex}].targets must be a non-empty array`);
    }
    return { source, targets: entry.targets.map((target, targetIndex) => parseTarget(target, targetIndex)) };
  });
}

function validateTargetUniqueness(files: PackageFile[]): void {
  const seen = new Set<string>();
  for (const file of files) {
    for (const target of file.targets) {
      const key = `${target.scope}\0${target.agent ?? "*"}\0${target.path}`;
      if (seen.has(key)) {
        throw new Error(`agent.yaml: duplicate target ${target.scope}/${target.agent ?? "shared"}/${target.path}`);
      }
      seen.add(key);
    }
  }
}

function validateImportTargets(manifest: PackageManifestV1): void {
  for (const file of manifest.files) {
    for (const target of file.targets) {
      if (target.mode !== "import") continue;
      const canonicalSource = manifest.canonical?.source;
      if (!canonicalSource) throw new Error("agent.yaml: import target requires canonical.source");
      const hasCanonicalTarget = manifest.files.some(
        (candidate) =>
          candidate.source === canonicalSource &&
          candidate.targets.some(
            (candidateTarget) =>
              candidateTarget.scope === target.scope &&
              candidateTarget.path === target.import &&
              candidateTarget.mode !== "import" &&
              (candidateTarget.agent === undefined || candidateTarget.agent === target.agent),
          ),
      );
      if (!hasCanonicalTarget) {
        throw new Error(`agent.yaml: import target ${target.path} requires a canonical target at ${target.import}`);
      }
    }
  }
}

function parseV1(raw: Record<string, unknown>): PackageManifestV1 {
  unknownFields(raw, new Set(["schema", "name", "description", "canonical", "files"]), "agent.yaml");
  const canonical = raw.canonical;
  let parsedCanonical: PackageManifestV1["canonical"];
  if (canonical !== undefined) {
    if (!isRecord(canonical)) throw new Error("agent.yaml: canonical must be an object");
    unknownFields(canonical, new Set(["source"]), "agent.yaml: canonical");
    parsedCanonical = { source: assertSafeRelativePath(canonical.source, "agent.yaml: canonical.source") };
  }
  const manifest: PackageManifestV1 = {
    schema: 1,
    name: requiredString(raw.name, "agent.yaml: name"),
    description: requiredString(raw.description, "agent.yaml: description"),
    ...(parsedCanonical === undefined ? {} : { canonical: parsedCanonical }),
    files: parseFiles(raw.files),
  };
  validateTargetUniqueness(manifest.files);
  validateImportTargets(manifest);
  return manifest;
}

function parseFragments(raw: unknown): FragmentDeclaration[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("agent.yaml: fragments must be a non-empty array");
  }
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`agent.yaml: fragments[${index}] must be an object`);
    unknownFields(entry, new Set(["id", "source", "title"]), `agent.yaml: fragments[${index}]`);
    const id = requiredString(entry.id, `agent.yaml: fragments[${index}].id`);
    if (!fragmentIdPattern.test(id)) throw new Error(`agent.yaml: fragments[${index}].id must be a simple identifier`);
    if (seen.has(id)) throw new Error(`agent.yaml: duplicate fragment id: ${id}`);
    seen.add(id);
    return {
      id,
      source: assertSafeRelativePath(entry.source, `agent.yaml: fragments[${index}].source`),
      title: requiredString(entry.title, `agent.yaml: fragments[${index}].title`),
    };
  });
}

function parseV2(raw: Record<string, unknown>): PackageManifestV2 {
  unknownFields(raw, new Set(["schema", "name", "description", "fragments"]), "agent.yaml");
  return {
    schema: 2,
    name: requiredString(raw.name, "agent.yaml: name"),
    description: requiredString(raw.description, "agent.yaml: description"),
    fragments: parseFragments(raw.fragments),
  };
}

export function parsePackageManifestBytes(bytes: Buffer | string): PackageManifest {
  const raw = parse(typeof bytes === "string" ? bytes : bytes.toString("utf8")) as unknown;
  if (!isRecord(raw)) throw new Error("agent.yaml: root must be an object");
  if (raw.schema === 1) return parseV1(raw);
  if (raw.schema === 2) return parseV2(raw);
  throw new Error("agent.yaml: schema must be 1 or 2");
}

function parsePackOutput(raw: unknown, index: number, memberIds: Set<string>): PackOutputDeclaration {
  if (!isRecord(raw)) throw new Error(`agents.yaml: outputs[${index}] must be an object`);
  unknownFields(raw, new Set(["directory", "use", "exclude"]), `agents.yaml: outputs[${index}]`);
  const directory = assertSafeDirectoryPath(raw.directory, `agents.yaml: outputs[${index}].directory`);
  if (!Array.isArray(raw.use) || raw.use.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error(`agents.yaml: outputs[${index}].use must be an array of aliases`);
  }
  const use = raw.use as string[];
  const seen = new Set<string>();
  for (const id of use) {
    if (!memberIds.has(id)) throw new Error(`agents.yaml: outputs[${index}].use references unknown member: ${id}`);
    if (seen.has(id)) throw new Error(`agents.yaml: outputs[${index}].use repeats member: ${id}`);
    seen.add(id);
  }
  const exclude = raw.exclude === undefined ? [] : raw.exclude;
  if (!Array.isArray(exclude) || exclude.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error(`agents.yaml: outputs[${index}].exclude must be an array of fragment IDs`);
  }
  return { directory, use, exclude: exclude as string[] };
}

function parsePackMember(raw: unknown, index: number): PackMemberDeclaration {
  if (!isRecord(raw)) throw new Error(`agents.yaml: packages[${index}] must be an object`);
  unknownFields(raw, new Set(["id", "source", "ref"]), `agents.yaml: packages[${index}]`);
  const member: PackMemberDeclaration = {
    id: requiredString(raw.id, `agents.yaml: packages[${index}].id`),
    source: requiredString(raw.source, `agents.yaml: packages[${index}].source`),
  };
  if (member.source.startsWith("/") || (!member.source.startsWith("./") && !member.source.startsWith("../") && member.source !== "." && !/^(?:github:|@|https?:\/\/|git@|file:\/\/)/.test(member.source))) {
    throw new Error(`agents.yaml: packages[${index}].source must be a Git source or explicit relative path`);
  }
  if (raw.ref !== undefined) member.ref = assertValidRef(raw.ref, `agents.yaml: packages[${index}].ref`);
  return member;
}

export function parsePackManifestBytes(bytes: Buffer | string): PackManifest {
  const raw = parse(typeof bytes === "string" ? bytes : bytes.toString("utf8")) as unknown;
  if (!isRecord(raw)) throw new Error("agents.yaml: root must be an object");
  unknownFields(raw, new Set(["version", "kind", "name", "packages", "outputs"]), "agents.yaml");
  if (raw.version !== 2 || raw.kind !== "pack") throw new Error("agents.yaml: version 2 kind pack required");
  if (!Array.isArray(raw.packages) || raw.packages.length === 0) throw new Error("agents.yaml: packages must be a non-empty array");
  const packages = raw.packages.map(parsePackMember);
  const ids = new Set<string>();
  for (const member of packages) {
    if (ids.has(member.id)) throw new Error(`agents.yaml: duplicate package member id: ${member.id}`);
    ids.add(member.id);
  }
  if (!Array.isArray(raw.outputs) || raw.outputs.length === 0) throw new Error("agents.yaml: outputs must be a non-empty array");
  const outputs = raw.outputs.map((entry, index) => parsePackOutput(entry, index, ids));
  const outputDirs = new Set<string>();
  for (const output of outputs) {
    if (outputDirs.has(output.directory)) throw new Error(`agents.yaml: duplicate output directory: ${output.directory}`);
    outputDirs.add(output.directory);
  }
  return { version: 2, kind: "pack", name: requiredString(raw.name, "agents.yaml: name"), packages, outputs };
}

export async function validateDeclaredSources(root: string, manifest: PackageManifest): Promise<void> {
  const rootReal = await realpath(root);
  const files = manifest.schema === 1
    ? [...manifest.files.map((file) => file.source), ...(manifest.canonical ? [manifest.canonical.source] : [])]
    : manifest.fragments.map((fragment) => fragment.source);
  const seen = new Set<string>();
  for (const source of files) {
    if (seen.has(source)) continue;
    seen.add(source);
    const absolute = join(root, ...source.split("/"));
    try {
      await access(absolute);
      const stat = await lstat(absolute);
      const targetReal = await realpath(absolute);
      if (!targetReal.startsWith(`${rootReal}/`) && targetReal !== rootReal) {
        throw new Error(`declared source escapes package root: ${source}`);
      }
      if (!stat.isFile()) throw new Error(`declared source is not a regular file: ${source}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("declared source")) throw error;
      throw new Error(`declared source file does not exist: ${source}`);
    }
  }
}

export async function readPackageManifest(root: string): Promise<{ manifest: PackageManifestV1; bytes: Buffer }> {
  const manifestPath = join(root, "agent.yaml");
  let bytes: Buffer;
  try {
    bytes = await readFile(manifestPath);
  } catch {
    throw new Error(`Package does not contain agent.yaml: ${root}`);
  }
  const manifest = parsePackageManifestBytes(bytes);
  if (manifest.schema !== 1) throw new Error("agent.yaml: schema must be 1 for legacy installation");
  await validateDeclaredSources(root, manifest);
  return { manifest, bytes };
}

export async function readPackageDocument(root: string): Promise<{ kind: "package"; manifest: PackageManifest; bytes: Buffer }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(root, "agent.yaml"));
  } catch {
    throw new Error(`Package does not contain agent.yaml: ${root}`);
  }
  const manifest = parsePackageManifestBytes(bytes);
  await validateDeclaredSources(root, manifest);
  return { kind: "package", manifest, bytes };
}

export async function readSourceDocument(root: string): Promise<
  | { kind: "package"; manifest: PackageManifest; bytes: Buffer }
  | { kind: "pack"; manifest: PackManifest; bytes: Buffer }
> {
  const packagePath = join(root, "agent.yaml");
  const packPath = join(root, "agents.yaml");
  let hasPackage = false;
  let hasPack = false;
  try {
    await access(packagePath);
    hasPackage = true;
  } catch {}
  try {
    await access(packPath);
    hasPack = true;
  } catch {}
  if (hasPackage && hasPack) throw new Error(`Ambiguous source directory contains both agent.yaml and agents.yaml: ${root}`);
  if (hasPackage) return readPackageDocument(root);
  if (hasPack) {
    const bytes = await readFile(packPath);
    return { kind: "pack", manifest: parsePackManifestBytes(bytes), bytes };
  }
  throw new Error(`Source does not contain agent.yaml or a pack agents.yaml: ${root}`);
}

export function targetsForScope(manifest: PackageManifestV1, scope: Scope): PackageTarget[] {
  return manifest.files.flatMap((file) => file.targets.filter((target) => target.scope === scope));
}

export function targetKey(target: PackageTarget): string {
  return `${target.scope}\0${target.agent ?? "*"}\0${normalize(target.path)}`;
}

export function isSourceKind(value: { kind: SourceKind }, expected: SourceKind): boolean {
  return value.kind === expected;
}

function assertAlias(value: unknown, field: string): string {
  const alias = requiredString(value, field);
  if (!fragmentIdPattern.test(alias)) throw new Error(`${field} must be a simple alias`);
  return alias;
}

function assertConsumerSource(value: unknown, field: string): string {
  const source = requiredString(value, field);
  if (
    isAbsolute(source) ||
    source.startsWith("/") ||
    (!source.startsWith("./") &&
      !source.startsWith("../") &&
      !/^(?:github:|@|https?:\/\/|git@|file:\/\/)[^\s]+$/.test(source))
  ) {
    throw new Error(`${field} must be a Git source or explicit ./ / ../ local path`);
  }
  return source;
}

function parseConsumerPackage(raw: unknown, index: number): V2PackageSelection {
  if (!isRecord(raw)) throw new Error(`agents.yaml: packages[${index}] must be an object`);
  unknownFields(raw, new Set(["id", "source", "ref", "compatibility"]), `agents.yaml: packages[${index}]`);
  const selection: V2PackageSelection = {
    id: assertAlias(raw.id, `agents.yaml: packages[${index}].id`),
    source: assertConsumerSource(raw.source, `agents.yaml: packages[${index}].source`),
  };
  if (raw.ref !== undefined) selection.ref = assertValidRef(raw.ref, `agents.yaml: packages[${index}].ref`);
  if (raw.compatibility !== undefined) {
    if (raw.compatibility !== "v1-canonical") throw new Error(`agents.yaml: packages[${index}].compatibility is invalid`);
    selection.compatibility = "v1-canonical";
  }
  return selection;
}

function parseConsumerPack(raw: unknown, index: number): V2PackSelection {
  if (!isRecord(raw)) throw new Error(`agents.yaml: packs[${index}] must be an object`);
  unknownFields(raw, new Set(["id", "source", "ref", "directory", "omitOutputs"]), `agents.yaml: packs[${index}]`);
  const omitRaw = raw.omitOutputs === undefined ? [] : raw.omitOutputs;
  if (!Array.isArray(omitRaw) || omitRaw.some((value) => typeof value !== "string")) {
    throw new Error(`agents.yaml: packs[${index}].omitOutputs must be an array`);
  }
  const omitOutputs = (omitRaw as string[]).map((value, omitIndex) =>
    assertSafeDirectoryPath(value, `agents.yaml: packs[${index}].omitOutputs[${omitIndex}]`),
  );
  return {
    id: assertAlias(raw.id, `agents.yaml: packs[${index}].id`),
    source: assertConsumerSource(raw.source, `agents.yaml: packs[${index}].source`),
    ...(raw.ref === undefined ? {} : { ref: assertValidRef(raw.ref, `agents.yaml: packs[${index}].ref`) }),
    directory: assertSafeDirectoryPath(raw.directory === undefined ? "." : raw.directory, `agents.yaml: packs[${index}].directory`),
    omitOutputs: [...new Set(omitOutputs)],
  };
}

function parseOutput(raw: unknown, index: number, global: boolean, aliases: Set<string>): V2OutputConfig {
  if (!isRecord(raw)) throw new Error(`agents.yaml: outputs[${index}] must be an object`);
  unknownFields(raw, new Set(["directory", "use", "exclude", "local", "adapters"]), `agents.yaml: outputs[${index}]`);
  if (global && raw.adapters !== undefined) throw new Error("agents.yaml: global outputs cannot declare adapters");
  if (!Array.isArray(raw.use) || raw.use.some((value) => typeof value !== "string")) {
    throw new Error(`agents.yaml: outputs[${index}].use must be an array`);
  }
  const use = raw.use as string[];
  const seen = new Set<string>();
  for (const alias of use) {
    if (!aliases.has(alias)) throw new Error(`agents.yaml: outputs[${index}].use references unknown alias: ${alias}`);
    if (seen.has(alias)) throw new Error(`agents.yaml: outputs[${index}].use repeats alias: ${alias}`);
    seen.add(alias);
  }
  const excludeRaw = raw.exclude === undefined ? [] : raw.exclude;
  const localRaw = raw.local === undefined ? [] : raw.local;
  if (!Array.isArray(excludeRaw) || excludeRaw.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error(`agents.yaml: outputs[${index}].exclude must be an array`);
  }
  if (!Array.isArray(localRaw) || localRaw.some((value) => typeof value !== "string")) {
    throw new Error(`agents.yaml: outputs[${index}].local must be an array`);
  }
  const local = (localRaw as string[]).map((value, localIndex) => assertSafeRelativePath(value, `agents.yaml: outputs[${index}].local[${localIndex}]`));
  const adaptersRaw = raw.adapters === undefined ? (global ? undefined : ["claude-code"]) : raw.adapters;
  if (adaptersRaw !== undefined && (!Array.isArray(adaptersRaw) || adaptersRaw.some((value) => typeof value !== "string" || !knownAgents.has(value)))) {
    throw new Error(`agents.yaml: outputs[${index}].adapters contains an unknown agent`);
  }
  return {
    directory: assertSafeDirectoryPath(raw.directory, `agents.yaml: outputs[${index}].directory`),
    use,
    exclude: [...new Set(excludeRaw as string[])],
    local,
    ...(adaptersRaw === undefined ? {} : { adapters: [...new Set(adaptersRaw as string[])] }),
  };
}

export function parseConsumerConfigBytes(bytes: Buffer | string, global = false): ConsumerConfigV2 {
  const raw = parse(typeof bytes === "string" ? bytes : bytes.toString("utf8")) as unknown;
  if (!isRecord(raw)) throw new Error("agents.yaml: root must be an object");
  unknownFields(raw, new Set(["version", "packages", "packs", "outputs", "agents"]), "agents.yaml");
  if (raw.version !== 2) throw new Error("agents.yaml: version must be 2");
  if (!Array.isArray(raw.packages) || !Array.isArray(raw.packs) || !Array.isArray(raw.outputs)) {
    throw new Error("agents.yaml: packages, packs, and outputs must be arrays");
  }
  const packages = raw.packages.map(parseConsumerPackage);
  const packs = raw.packs.map(parseConsumerPack);
  const aliases = new Set<string>();
  for (const selection of [...packages, ...packs]) {
    if (aliases.has(selection.id)) throw new Error(`agents.yaml: duplicate alias: ${selection.id}`);
    aliases.add(selection.id);
  }
  const agentsRaw = raw.agents === undefined ? ["claude-code"] : raw.agents;
  if (!Array.isArray(agentsRaw) || agentsRaw.length === 0 || agentsRaw.some((value) => typeof value !== "string" || !knownAgents.has(value))) {
    throw new Error("agents.yaml: agents must contain registered agent names");
  }
  if (!global && raw.agents !== undefined) throw new Error("agents.yaml: agents is only valid for global scope");
  const outputs = raw.outputs.map((entry, index) => parseOutput(entry, index, global, aliases));
  const outputDirs = new Set<string>();
  for (const output of outputs) {
    const key = output.directory.toLowerCase();
    if (outputDirs.has(key)) throw new Error(`agents.yaml: duplicate output directory: ${output.directory}`);
    outputDirs.add(key);
    const generated = new Set<string>([
      output.directory === "." ? "AGENTS.md" : `${output.directory}/AGENTS.md`,
      ...(output.adapters?.includes("claude-code") ? [output.directory === "." ? "CLAUDE.md" : `${output.directory}/CLAUDE.md`] : []),
    ]);
    for (const local of output.local) {
      if (generated.has(local)) throw new Error(`agents.yaml: output ${output.directory} local overlaps generated file: ${local}`);
      if (!global && (local === "agents.yaml" || local === "agents.lock")) throw new Error(`agents.yaml: local input overlaps state file: ${local}`);
      if (global && (local === "agents.yaml" || local === "agents.lock")) throw new Error(`agents.yaml: global local input overlaps state file: ${local}`);
    }
  }
  if (global && outputs.some((output) => output.directory !== ".")) {
    throw new Error("agents.yaml: global scope permits only output directory .");
  }
  return {
    version: 2,
    packages,
    packs,
    outputs,
    ...(global ? { agents: [...new Set(agentsRaw as string[])] } : {}),
  };
}
