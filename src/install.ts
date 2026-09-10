import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify, parse } from "yaml";
import { destinationForTarget, configDirectory } from "./paths.js";
import { resolvePackage } from "./git.js";
import { targetKey, targetsForScope } from "./manifest.js";
import type {
  LockFile,
  LockPackage,
  LockTarget,
  PackageReference,
  PackageTarget,
  ResolvedPackage,
  Scope,
  SourceDescriptor,
  StateFile,
} from "./types.js";

function sha256(value: Buffer | string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function emptyState(): StateFile {
  return { version: 1, packages: [] };
}

function emptyLock(): LockFile {
  return { version: 1, packages: {} };
}

async function readYaml<T>(path: string, fallback: T): Promise<T> {
  try {
    return (parse(await readFile(path, "utf8")) as T) ?? fallback;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeYaml(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringify(value), "utf8");
}

function statePaths(scope: Scope, projectRoot: string): { state: string; lock: string } {
  if (scope === "project") {
    return { state: join(projectRoot, "agents.yaml"), lock: join(projectRoot, "agents.lock") };
  }
  const root = configDirectory();
  return { state: join(root, "global.yaml"), lock: join(root, "global.lock") };
}

function packageReference(id: string, source: SourceDescriptor, selector: string): PackageReference {
  return { id, source, selector };
}

function updateState(state: StateFile, reference: PackageReference): StateFile {
  const packages = state.packages.filter((candidate) => candidate.id !== reference.id);
  packages.push(reference);
  return { ...state, version: 1, packages };
}

function renderTarget(target: PackageTarget, source: Buffer, manifest: ResolvedPackage["manifest"]): Buffer {
  if (target.mode === "import") {
    if (target.agent !== "claude-code") {
      throw new Error(`No import renderer is available for agent: ${target.agent ?? "shared"}`);
    }
    return Buffer.from(`@${target.import}\n`, "utf8");
  }
  return source;
}

interface PlannedWrite {
  destination: string;
  contents: Buffer;
  target: PackageTarget;
}

async function planWrites(
  resolved: ResolvedPackage,
  scope: Scope,
  projectRoot: string,
): Promise<PlannedWrite[]> {
  const planned: PlannedWrite[] = [];
  const seen = new Set<string>();

  for (const file of resolved.manifest.files) {
    const source = await readFile(join(resolved.root, file.source));
    for (const target of file.targets.filter((candidate) => candidate.scope === scope)) {
      const destination = destinationForTarget(target, projectRoot);
      const key = targetKey(target) + `\0${destination}`;
      if (seen.has(key)) {
        throw new Error(`Package resolves duplicate target: ${target.path}`);
      }
      seen.add(key);
      planned.push({ destination, contents: renderTarget(target, source, resolved.manifest), target });
    }
  }

  for (const write of planned) {
    try {
      const current = await readFile(write.destination);
      if (!current.equals(write.contents)) {
        throw new Error(`Conflict: ${write.destination} already exists with different content`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return planned;
}

async function applyWrites(writes: PlannedWrite[]): Promise<void> {
  for (const write of writes) {
    await mkdir(dirname(write.destination), { recursive: true });
    await writeFile(write.destination, write.contents);
  }
}

function lockPackage(
  resolved: ResolvedPackage,
  scope: Scope,
  requested: string,
  writes: PlannedWrite[],
): LockPackage {
  const files: LockTarget[] = writes.map((write) => ({
    scope: write.target.scope,
    ...(write.target.agent === undefined ? {} : { agent: write.target.agent }),
    path: write.target.path,
    mode: write.target.mode,
    ...(write.target.import === undefined ? {} : { import: write.target.import }),
    sha256: sha256(write.contents),
  }));
  return {
    scope,
    source: resolved.source,
    requested,
    commit: resolved.commit,
    manifestSha256: sha256(resolved.manifestBytes),
    files,
  };
}

async function installScope(
  resolved: ResolvedPackage,
  id: string,
  requested: string,
  scope: Scope,
  projectRoot: string,
): Promise<string[]> {
  const targets = targetsForScope(resolved.manifest, scope);
  if (targets.length === 0) {
    return [];
  }

  const writes = await planWrites(resolved, scope, projectRoot);
  const paths = statePaths(scope, projectRoot);
  const state = await readYaml<StateFile>(paths.state, emptyState());
  const lock = await readYaml<LockFile>(paths.lock, emptyLock());
  const reference = packageReference(id, resolved.source, requested);
  const nextState = updateState(state, reference);
  const nextLock: LockFile = {
    ...lock,
    version: 1,
    packages: { ...lock.packages, [id]: lockPackage(resolved, scope, requested, writes) },
  };

  await applyWrites(writes);
  await writeYaml(paths.state, nextState);
  await writeYaml(paths.lock, nextLock);
  return writes.map((write) => write.destination);
}

export async function addPackage(reference: string, projectRoot: string): Promise<{ id: string; files: string[]; commit: string }> {
  const resolved = await resolvePackage(reference, projectRoot);
  const id = reference.startsWith("@")
    ? reference.slice(1).split("#", 1)[0]
    : resolved.manifest.name;
  try {
    const files = [
      ...(await installScope(resolved, id, reference, "project", projectRoot)),
      ...(await installScope(resolved, id, reference, "global", projectRoot)),
    ];
    return { id, files, commit: resolved.commit };
  } finally {
    await resolved.cleanup?.();
  }
}

export async function initProject(projectRoot: string): Promise<void> {
  const paths = statePaths("project", projectRoot);
  const state = await readYaml<StateFile>(paths.state, emptyState());
  const lock = await readYaml<LockFile>(paths.lock, emptyLock());
  await writeYaml(paths.state, state);
  await writeYaml(paths.lock, lock);
}

export function declaredScopes(resolved: ResolvedPackage): Scope[] {
  return ["project", "global"].filter((scope) => targetsForScope(resolved.manifest, scope as Scope).length > 0) as Scope[];
}
