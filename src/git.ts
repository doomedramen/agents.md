import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { readPackageManifest } from "./manifest.js";
import type { ResolvedPackage, SourceDescriptor } from "./types.js";

const execFile = promisify(execFileCallback);

async function git(args: string[], cwd: string): Promise<string> {
  try {
    const result = await execFile("git", args, { cwd, maxBuffer: 4 * 1024 * 1024 });
    return result.stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Git command failed in ${cwd}: ${message}`);
  }
}

function splitRemoteReference(reference: string): { url: string; packagePath: string } {
  const hashIndex = reference.indexOf("#");
  if (hashIndex === -1) {
    return { url: reference, packagePath: "." };
  }
  return {
    url: reference.slice(0, hashIndex),
    packagePath: reference.slice(hashIndex + 1) || ".",
  };
}

function githubReference(reference: string): { url: string; packagePath: string } | undefined {
  const withoutAt = reference.startsWith("@") ? reference.slice(1) : reference;
  const githubPrefix = withoutAt.startsWith("github:") ? withoutAt.slice("github:".length) : withoutAt;
  if (!/^[^/\s]+\/[^/\s#]+(?:#.*)?$/.test(githubPrefix)) {
    return undefined;
  }
  const { url, packagePath } = splitRemoteReference(githubPrefix);
  return { url: `https://github.com/${url.replace(/\.git$/, "")}.git`, packagePath };
}

function remoteReference(reference: string): { url: string; packagePath: string } | undefined {
  if (reference.startsWith("https://") || reference.startsWith("http://") || reference.startsWith("git@")) {
    return splitRemoteReference(reference);
  }
  return githubReference(reference);
}

export async function resolvePackage(reference: string, cwd: string): Promise<ResolvedPackage> {
  const localCandidate = isAbsolute(reference) ? reference : resolve(cwd, reference);
  if (existsSync(localCandidate)) {
    const root = resolve(localCandidate);
    const { manifest, bytes } = await readPackageManifest(root);
    const commit = await git(["rev-parse", "HEAD"], root);
    const source: SourceDescriptor = { type: "git", url: root, path: "." };
    return { root, source, commit, manifest, manifestBytes: bytes };
  }

  const remote = remoteReference(reference);
  if (!remote) {
    throw new Error(`Unsupported package source: ${reference}`);
  }

  const cloneRoot = await mkdtemp(join(tmpdir(), "agents-md-source-"));
  try {
    await git(["clone", "--depth=1", remote.url, cloneRoot], cwd);
    const root = resolve(cloneRoot, remote.packagePath);
    const { manifest, bytes } = await readPackageManifest(root);
    const commit = await git(["rev-parse", "HEAD"], cloneRoot);
    const source: SourceDescriptor = { type: "git", url: remote.url, path: remote.packagePath };
    return {
      root,
      source,
      commit,
      manifest,
      manifestBytes: bytes,
      cleanup: async () => rm(cloneRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(cloneRoot, { recursive: true, force: true });
    throw error;
  }
}
