import { access, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse } from "yaml";
import type { DetectionEvidence } from "./types.js";

interface ManifestRecord {
  path: string;
  value: Record<string, unknown>;
}

const catalog: Array<{ technology: string; packages: string[] }> = [
  { technology: "TypeScript", packages: ["typescript"] },
  { technology: "Express", packages: ["express"] },
  { technology: "Prisma", packages: ["prisma", "@prisma/client"] },
  { technology: "MySQL", packages: ["mysql2", "mysql", "@planetscale/database"] },
  { technology: "Next.js", packages: ["next"] },
  { technology: "Hono", packages: ["hono"] },
  { technology: "Turborepo", packages: ["turbo"] },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function directories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git").map((entry) => join(path, entry.name));
  } catch {
    return [];
  }
}

async function expandWorkspacePattern(root: string, pattern: string): Promise<string[]> {
  const parts = pattern.replaceAll("\\", "/").split("/").filter(Boolean);
  let current = [root];
  for (const part of parts) {
    const next: string[] = [];
    if (part === "*") {
      for (const path of current) next.push(...await directories(path));
    } else if (part.includes("*")) {
      const prefix = part.slice(0, part.indexOf("*"));
      const suffix = part.slice(part.lastIndexOf("*") + 1);
      for (const path of current) {
        for (const child of await directories(path)) {
          const name = child.slice(path.length + 1);
          if (name.startsWith(prefix) && name.endsWith(suffix)) next.push(child);
        }
      }
    } else {
      for (const path of current) next.push(join(path, part));
    }
    current = next;
  }
  return current;
}

async function workspacePaths(root: string, packageJson: Record<string, unknown>): Promise<string[]> {
  const raw = packageJson.workspaces;
  const patterns = Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : isRecord(raw) && Array.isArray(raw.packages) ? raw.packages.filter((value): value is string => typeof value === "string") : [];
  let result: string[] = [];
  for (const pattern of patterns) result.push(...await expandWorkspacePattern(root, pattern));
  try {
    const pnpm = parse(await readFile(join(root, "pnpm-workspace.yaml"), "utf8")) as unknown;
    if (isRecord(pnpm) && Array.isArray(pnpm.packages)) {
      for (const pattern of pnpm.packages.filter((value): value is string => typeof value === "string")) result.push(...await expandWorkspacePattern(root, pattern));
    }
  } catch {}
  return [...new Set(result.map((path) => join(path, "package.json")))];
}

function dependencyEvidence(record: ManifestRecord): DetectionEvidence[] {
  const evidence: DetectionEvidence[] = [];
  for (const section of ["dependencies", "devDependencies"]) {
    const dependencies = record.value[section];
    if (!isRecord(dependencies)) continue;
    for (const entry of catalog) {
      for (const packageName of entry.packages) {
        const version = dependencies[packageName];
        if (typeof version === "string") evidence.push({ technology: entry.technology, path: record.path, field: `${section}.${packageName}`, value: version });
      }
    }
  }
  return evidence;
}

export async function detectProjectData(root: string): Promise<{ evidence: DetectionEvidence[]; errors: string[] }> {
  const errors: string[] = [];
  const manifests: ManifestRecord[] = [];
  const rootPackagePath = join(root, "package.json");
  const rootPackage = await readJson(rootPackagePath);
  if (rootPackage) manifests.push({ path: "package.json", value: rootPackage });
  else {
    try {
      await access(rootPackagePath);
      errors.push("package.json is malformed");
    } catch {}
  }
  if (rootPackage) {
    for (const path of await workspacePaths(root, rootPackage)) {
      const value = await readJson(path);
      if (value) manifests.push({ path: relative(root, path).replaceAll("\\", "/"), value });
      else errors.push(`${relative(root, path).replaceAll("\\", "/")} is malformed or unreadable`);
    }
  }
  const evidence = manifests.flatMap(dependencyEvidence);
  for (const [technology, path] of [["TypeScript", "tsconfig.json"], ["Prisma", "prisma/schema.prisma"], ["Turborepo", "turbo.json"]] as const) {
    try {
      await access(join(root, path));
      evidence.push({ technology, path, field: "file", value: path });
    } catch {}
  }
  const unique = new Map<string, DetectionEvidence>();
  for (const item of evidence) unique.set(`${item.technology}\0${item.path}\0${item.field}\0${item.value}`, item);
  return { evidence: [...unique.values()], errors };
}

export async function detectProject(root: string): Promise<string> {
  const result = await detectProjectData(root);
  const technologies = [...new Set(result.evidence.map((item) => item.technology))];
  const lines = ["Detected technologies:"];
  if (technologies.length === 0) lines.push("- none");
  for (const technology of technologies) {
    lines.push(`- ${technology}`);
    for (const item of result.evidence.filter((candidate) => candidate.technology === technology)) {
      lines.push(`  evidence: ${item.path} (${item.field}=${item.value})`);
    }
  }
  lines.push("Suggested packages:");
  if (technologies.length === 0) lines.push("- none");
  for (const technology of technologies) {
    lines.push(`- ${technology.toLowerCase().replaceAll(".", "").replaceAll(" ", "-")}: no configured Git source`);
  }
  if (result.errors.length > 0) {
    lines.push("Manifest warnings:");
    for (const error of result.errors) lines.push(`- ${error}`);
  }
  return lines.join("\n");
}
