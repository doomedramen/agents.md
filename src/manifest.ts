import { access, readFile } from "node:fs/promises";
import { isAbsolute, join, normalize, posix, win32 } from "node:path";
import { parse } from "yaml";
import type { PackageFile, PackageManifest, PackageTarget, Scope, TargetMode } from "./types.js";

const scopes = new Set<Scope>(["project", "global"]);
const modes = new Set<TargetMode>(["direct", "import", "copy"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`agent.yaml: ${field} must be a non-empty string`);
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
    normalizedSeparators === "."
  ) {
    throw new Error(`agent.yaml: ${field} must be a safe relative path`);
  }
  return normalizedSeparators;
}

function parseTarget(raw: unknown, index: number): PackageTarget {
  if (!isRecord(raw)) {
    throw new Error(`agent.yaml: files target ${index} must be an object`);
  }

  const rawScope = requiredString(raw.scope, `files target ${index}.scope`) as Scope;
  if (!scopes.has(rawScope)) {
    throw new Error(`agent.yaml: files target ${index}.scope must be project or global`);
  }

  const agent = raw.agent === undefined ? undefined : requiredString(raw.agent, `files target ${index}.agent`);
  if (rawScope === "global" && agent === undefined) {
    throw new Error(`agent.yaml: global files target ${index} requires agent`);
  }

  const mode = (raw.mode === undefined ? "direct" : requiredString(raw.mode, `files target ${index}.mode`)) as TargetMode;
  if (!modes.has(mode)) {
    throw new Error(`agent.yaml: files target ${index}.mode must be direct, import, or copy`);
  }

  const target: PackageTarget = {
    scope: rawScope,
    ...(agent === undefined ? {} : { agent }),
    path: assertSafeRelativePath(raw.path, `files target ${index}.path`),
    mode,
  };

  if (mode === "import") {
    target.import = assertSafeRelativePath(raw.import, `files target ${index}.import`);
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
      const source = assertSafeRelativePath(entry, `files[${fileIndex}]`);
      return {
        source,
        targets: [{ scope: "project", path: source, mode: "direct" }],
      };
    }

    if (!isRecord(entry)) {
      throw new Error(`agent.yaml: files[${fileIndex}] must be a string or object`);
    }

    const source = assertSafeRelativePath(entry.source, `files[${fileIndex}].source`);
    if (!Array.isArray(entry.targets) || entry.targets.length === 0) {
      throw new Error(`agent.yaml: files[${fileIndex}].targets must be a non-empty array`);
    }

    return {
      source,
      targets: entry.targets.map((target, targetIndex) => parseTarget(target, targetIndex)),
    };
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

function validateImportTargets(manifest: PackageManifest): void {
  for (const file of manifest.files) {
    for (const target of file.targets) {
      if (target.mode !== "import") {
        continue;
      }
      const canonicalSource = manifest.canonical?.source;
      if (!canonicalSource) {
        throw new Error("agent.yaml: import target requires canonical.source");
      }

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
        throw new Error(
          `agent.yaml: import target ${target.path} requires a canonical target at ${target.import}`,
        );
      }
    }
  }
}

async function validateSources(root: string, manifest: PackageManifest): Promise<void> {
  for (const file of manifest.files) {
    try {
      await access(join(root, file.source));
    } catch {
      throw new Error(`agent.yaml: declared source file does not exist: ${file.source}`);
    }
  }
  if (manifest.canonical) {
    try {
      await access(join(root, manifest.canonical.source));
    } catch {
      throw new Error(`agent.yaml: canonical source does not exist: ${manifest.canonical.source}`);
    }
  }
}

export async function readPackageManifest(root: string): Promise<{ manifest: PackageManifest; bytes: Buffer }> {
  const manifestPath = join(root, "agent.yaml");
  let bytes: Buffer;
  try {
    bytes = await readFile(manifestPath);
  } catch {
    throw new Error(`Package does not contain agent.yaml: ${root}`);
  }

  const raw = parse(bytes.toString("utf8")) as unknown;
  if (!isRecord(raw)) {
    throw new Error("agent.yaml: root must be an object");
  }
  if (raw.schema !== 1) {
    throw new Error("agent.yaml: schema must be 1");
  }

  const canonical = raw.canonical;
  let parsedCanonical: PackageManifest["canonical"];
  if (canonical !== undefined) {
    if (!isRecord(canonical)) {
      throw new Error("agent.yaml: canonical must be an object");
    }
    parsedCanonical = { source: assertSafeRelativePath(canonical.source, "canonical.source") };
  }

  const manifest: PackageManifest = {
    schema: 1,
    name: requiredString(raw.name, "name"),
    description: requiredString(raw.description, "description"),
    ...(parsedCanonical === undefined ? {} : { canonical: parsedCanonical }),
    files: parseFiles(raw.files),
  };

  validateTargetUniqueness(manifest.files);
  validateImportTargets(manifest);
  await validateSources(root, manifest);
  return { manifest, bytes };
}

export function targetsForScope(manifest: PackageManifest, scope: Scope): PackageTarget[] {
  return manifest.files.flatMap((file) => file.targets.filter((target) => target.scope === scope));
}

export function targetKey(target: PackageTarget): string {
  return `${target.scope}\0${target.agent ?? "*"}\0${normalize(target.path)}`;
}
