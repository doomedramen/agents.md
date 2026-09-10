import { execFile as execFileCallback } from "node:child_process";
import { cp, existsSync } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { configDirectory } from "./paths.js";
import { parsePackageManifestBytes, readPackageManifest, readSourceDocument, assertSafeDirectoryPath, assertValidRef } from "./manifest.js";
import type { PackManifest, PackageManifestV1, ResolvedPackage, ResolvedV2Source, SourceDescriptor } from "./types.js";
import { createHash } from "node:crypto";

const execFile = promisify(execFileCallback);

async function git(args: string[], cwd: string, allowFailure = false): Promise<string> {
  try {
    const result = await execFile("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
    return result.stdout.trim();
  } catch (error) {
    if (allowFailure) return "";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Git command failed in ${cwd}: ${message}`);
  }
}

export async function gitRevision(cwd: string): Promise<string> {
  return git(["rev-parse", "HEAD"], cwd);
}

export function splitSourceReference(reference: string): { source: string; packagePath: string } {
  const hashIndex = reference.indexOf("#");
  if (hashIndex === -1) return { source: reference, packagePath: "." };
  return { source: reference.slice(0, hashIndex), packagePath: reference.slice(hashIndex + 1) || "." };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isExplicitLocalSource(source: string): boolean {
  return isAbsolute(source) || source.startsWith("./") || source.startsWith("../") || source === "." || source === "..";
}

function githubReference(reference: string): { url: string; packagePath: string } | undefined {
  const withoutAt = reference.startsWith("@") ? reference.slice(1) : reference;
  const githubPrefix = withoutAt.startsWith("github:") ? withoutAt.slice("github:".length) : withoutAt;
  if (!/^[^/\s]+\/[^/\s#]+(?:#.*)?$/.test(githubPrefix)) return undefined;
  const { source, packagePath } = splitSourceReference(githubPrefix);
  return { url: `https://github.com/${source.replace(/\.git$/, "")}.git`, packagePath };
}

function remoteReference(reference: string): { url: string; packagePath: string } | undefined {
  if (
    reference.startsWith("https://") ||
    reference.startsWith("http://") ||
    reference.startsWith("git@") ||
    reference.startsWith("file://")
  ) {
    const { source, packagePath } = splitSourceReference(reference);
    return { url: source, packagePath };
  }
  return githubReference(reference);
}

function validateRepositoryPath(packagePath: string): string {
  return assertSafeDirectoryPath(packagePath, "source package path");
}

async function assertNoEscapingPath(repositoryRoot: string, packageRoot: string, label: string): Promise<void> {
  const repositoryReal = await realpath(repositoryRoot);
  const packageReal = await realpath(packageRoot);
  if (packageReal !== repositoryReal && !packageReal.startsWith(`${repositoryReal}/`)) {
    throw new Error(`${label} escapes Git repository: ${packageRoot}`);
  }
}

async function localSource(reference: string, cwd: string): Promise<{ source: SourceDescriptor; repositoryRoot: string }> {
  const { source: sourcePath, packagePath: suffix } = splitSourceReference(reference);
  const candidate = resolve(cwd, sourcePath);
  try {
    await access(candidate);
  } catch {
    throw new Error(`Local Git source does not exist: ${sourcePath}`);
  }
  const repositoryRoot = resolve(await git(["rev-parse", "--show-toplevel"], candidate));
  const repositoryReal = await realpath(repositoryRoot);
  await assertNoEscapingPath(repositoryRoot, candidate, "Local Git source");
  const candidatePath = relative(repositoryReal, await realpath(candidate)).replaceAll("\\", "/") || ".";
  const normalizedSuffix = validateRepositoryPath(suffix);
  const packagePath = candidatePath === "." ? normalizedSuffix : validateRepositoryPath(join(candidatePath, normalizedSuffix));
  const packageRoot = join(repositoryReal, ...packagePath.split("/"));
  await lstat(packageRoot);
  await assertNoEscapingPath(repositoryReal, packageRoot, "Local Git package path");
  return { source: { type: "git", url: repositoryReal, path: packagePath }, repositoryRoot: repositoryReal };
}

export async function parseGitSource(reference: string, cwd: string, requireExplicitLocal = false): Promise<{ source: SourceDescriptor; repositoryRoot?: string }> {
  const sourcePart = splitSourceReference(reference).source;
  if (isAbsolute(sourcePart) && requireExplicitLocal) {
    throw new Error(`Local Git sources must start with ./ or ../: ${reference}`);
  }
  if (isExplicitLocalSource(sourcePart)) {
    return localSource(reference, cwd);
  }
  const remote = remoteReference(reference);
  if (!remote) {
    if (requireExplicitLocal) throw new Error(`Local Git sources must start with ./ or ../: ${reference}`);
    throw new Error(`Unsupported package source: ${reference}`);
  }
  return { source: { type: "git", url: remote.url, path: validateRepositoryPath(remote.packagePath) } };
}

export function sourceIdentity(source: SourceDescriptor): string {
  return `${source.url}#${source.path}`;
}

async function resolveLocalCommit(repositoryRoot: string, requestedRef?: string): Promise<string> {
  if (requestedRef !== undefined) assertValidRef(requestedRef, "ref");
  const ref = requestedRef ?? "HEAD";
  const commit = await git(["rev-parse", "--verify", `${ref}^{commit}`], repositoryRoot);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Git ref did not resolve to a full commit: ${ref}`);
  return commit;
}

async function cloneRepository(url: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agents-md-git-"));
  try {
    await git(["clone", "--quiet", "--no-checkout", url, root], process.cwd());
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function resolveRemoteCommit(repositoryRoot: string, requestedRef?: string): Promise<string> {
  if (requestedRef !== undefined) {
    assertValidRef(requestedRef, "ref");
    await git(["fetch", "--quiet", "origin", requestedRef], repositoryRoot);
    const commit = await git(["rev-parse", "--verify", "FETCH_HEAD^{commit}"], repositoryRoot);
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Git ref did not resolve to a full commit: ${requestedRef}`);
    return commit;
  }
  const commit = await git(["rev-parse", "--verify", "HEAD^{commit}"], repositoryRoot);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Git remote has no default commit");
  return commit;
}

async function cachePath(source: SourceDescriptor, commit: string): Promise<string> {
  return join(configDirectory(), "cache", "v2", `${hash(sourceIdentity(source))}-${commit}`);
}

async function validCache(path: string, commit: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory()) return false;
    const cachedCommit = await git(["rev-parse", "HEAD"], path, true);
    return cachedCommit === commit;
  } catch {
    return false;
  }
}

async function cloneCommitToCache(source: SourceDescriptor, commit: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const stageParent = await mkdtemp(join(dirname(destination), ".stage-"));
  const stage = join(stageParent, "repository");
  try {
    await git(["clone", "--quiet", "--no-checkout", source.url, stage], process.cwd());
    await git(["fetch", "--quiet", "origin", commit], stage, true);
    await git(["checkout", "--detach", "--quiet", commit], stage);
    if (await validCache(destination, commit)) return;
    try {
      await rename(stage, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST" && await validCache(destination, commit)) return;
      throw error;
    }
  } catch (error) {
    throw error;
  } finally {
    await rm(stageParent, { recursive: true, force: true });
  }
}

export async function ensureCachedSnapshot(
  source: SourceDescriptor,
  commit: string,
  offline = false,
): Promise<string> {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Locked commit must be a full Git commit: ${commit}`);
  const destination = await cachePath(source, commit);
  if (await validCache(destination, commit)) return destination;
  if (offline) {
    throw new Error(`Offline cache miss for ${sourceIdentity(source)} at ${commit}`);
  }
  await cloneCommitToCache(source, commit, destination);
  if (!(await validCache(destination, commit))) throw new Error(`Cached Git snapshot failed verification: ${destination}`);
  return destination;
}

async function currentSnapshot(
  reference: string,
  cwd: string,
  requestedRef?: string,
  requireExplicitLocal = true,
): Promise<ResolvedV2Source> {
  const parsed = await parseGitSource(reference, cwd, requireExplicitLocal);
  const source = parsed.source;
  let repositoryRoot: string;
  let commit: string;
  let temporary: string | undefined;
  if (parsed.repositoryRoot) {
    repositoryRoot = parsed.repositoryRoot;
    commit = await resolveLocalCommit(repositoryRoot, requestedRef);
  } else {
    temporary = await cloneRepository(source.url);
    repositoryRoot = temporary;
    commit = await resolveRemoteCommit(repositoryRoot, requestedRef);
  }
  const cachedRoot = await ensureCachedSnapshot(source, commit, false);
  const packageRoot = join(cachedRoot, ...source.path.split("/"));
  try {
    await access(packageRoot);
    await assertNoEscapingPath(cachedRoot, packageRoot, "Git package path");
  } catch (error) {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    throw error instanceof Error ? error : new Error(String(error));
  }
  if (temporary) await rm(temporary, { recursive: true, force: true });
  return { root: packageRoot, repositoryRoot: cachedRoot, source, commit, requestedRef };
}

export async function resolveV2Source(
  reference: string,
  cwd: string,
  requestedRef?: string,
  requireExplicitLocal = true,
): Promise<ResolvedV2Source> {
  return currentSnapshot(reference, cwd, requestedRef, requireExplicitLocal);
}

export async function resolveV2SourceAt(
  source: SourceDescriptor,
  commit: string,
  offline = false,
): Promise<ResolvedV2Source> {
  const repositoryRoot = await ensureCachedSnapshot(source, commit, offline);
  const root = join(repositoryRoot, ...source.path.split("/"));
  try {
    await access(root);
    await assertNoEscapingPath(repositoryRoot, root, "Locked Git package path");
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  return { root, repositoryRoot, source, commit };
}

export async function resolvePackage(reference: string, cwd: string): Promise<ResolvedPackage> {
  const resolved = await currentSnapshot(reference, cwd, undefined, false);
  const { manifest, bytes } = await readPackageManifest(resolved.root);
  return { root: resolved.root, source: resolved.source, commit: resolved.commit, manifest, manifestBytes: bytes };
}

export async function resolvePackageAt(source: SourceDescriptor, commit: string): Promise<ResolvedPackage> {
  const resolved = await resolveV2SourceAt(source, commit, false);
  const { manifest, bytes } = await readPackageManifest(resolved.root);
  return { root: resolved.root, source, commit, manifest, manifestBytes: bytes };
}

export async function readResolvedSource(resolved: ResolvedV2Source): Promise<
  | { kind: "package"; manifest: PackageManifestV1 | import("./types.js").PackageManifestV2; bytes: Buffer }
  | { kind: "pack"; manifest: PackManifest; bytes: Buffer }
> {
  return readSourceDocument(resolved.root);
}

export async function readCachedFile(root: string, path: string): Promise<Buffer> {
  const absolute = join(root, ...path.split("/"));
  await assertNoEscapingPath(root, absolute, "Cached source file");
  return readFile(absolute);
}

export function sourceReference(source: SourceDescriptor): string {
  const path = source.path === "." ? "" : `#${source.path}`;
  return `${source.url}${path}`;
}
