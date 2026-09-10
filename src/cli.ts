#!/usr/bin/env node

import { resolve } from "node:path";
import { parse } from "yaml";
import { readFile } from "node:fs/promises";
import { addPackage } from "./install.js";
import { readResolvedSource, resolveV2Source } from "./git.js";
import {
  addV2,
  checkV2,
  diffV2,
  editV2,
  initV2,
  migrateV1,
  outdatedV2,
  removeV2,
  renderV2,
  updateV2,
} from "./v2.js";
import { configDirectory, globalConfigDirectory } from "./paths.js";

class UsageError extends Error {}
class ExitCodeError extends Error {
  constructor(public readonly code: number, message = "") {
    super(message);
  }
}

function usage(): string {
  return `Usage: agents.md <command> [arguments]

Commands:
  init [--global] [--adopt] [--agents <list>] [--dry-run]
  add <source>... [--ref <ref>] [--dir <directory>] [--id <id>] [--global] [--dry-run]
  remove <id>... [--global]
  render [--offline] [--global]
  diff [--update] [--global]
  update [<id>...] [--global]
  outdated [--global]
  check [--offline] [--global]
  detect
  edit [--dir <directory>] [--global]
  migrate [--dry-run]

Run agents.md <command> --help for command help.
Equivalent invocation: npx @doomedramen/agents.md <command> ...`;
}

function commandHelp(command: string): string {
  const text: Record<string, string> = {
    init: "init [--global] [--adopt] [--agents claude-code,codex] [--dry-run]",
    add: "add <source>... [--ref <ref>] [--dir <directory>] [--id <id>] [--global] [--agents <list>] [--dry-run]",
    remove: "remove <id>... [--global]",
    render: "render [--offline] [--global]",
    diff: "diff [--update] [--global]",
    update: "update [<id>...] [--global] [--offline]",
    outdated: "outdated [--global]",
    check: "check [--offline] [--global]",
    detect: "detect",
    edit: "edit [--dir <directory>] [--global]",
    migrate: "migrate [--dry-run]",
  };
  return text[command] ? `Usage: agents.md ${text[command]}` : usage();
}

interface Parsed {
  positional: string[];
  flags: Set<string>;
  values: Map<string, string>;
}

function parseArgs(args: string[], allowedFlags: Set<string>, allowedValues: Set<string>): Parsed {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      flags.add("help");
      continue;
    }
    if (arg === "--scope") throw new UsageError("scope is declared by agent.yaml");
    if (allowedFlags.has(arg)) {
      flags.add(arg.slice(2));
      continue;
    }
    if (allowedValues.has(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new UsageError(`${arg} requires a value`);
      values.set(arg.slice(2), value);
      continue;
    }
    throw new UsageError(`Unknown option: ${arg}`);
  }
  return { positional, flags, values };
}

function hasFlag(parsed: Parsed, name: string): boolean {
  return parsed.flags.has(name);
}

function agentsValue(parsed: Parsed): string[] | undefined {
  const value = parsed.values.get("agents");
  return value === undefined ? undefined : value.split(",").map((agent) => agent.trim()).filter(Boolean);
}

async function v2ConfigExists(projectRoot: string, global: boolean): Promise<boolean> {
  const path = global ? `${globalConfigDirectory()}/agents.yaml` : `${projectRoot}/agents.yaml`;
  try {
    const value = parse(await readFile(path, "utf8")) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) && (value as Record<string, unknown>).version === 2;
  } catch {
    return false;
  }
}

async function inspectSources(references: string[], projectRoot: string, ref?: string): Promise<Array<"v1" | "v2-package" | "v2-pack">> {
  const kinds: Array<"v1" | "v2-package" | "v2-pack"> = [];
  for (const reference of references) {
    const resolved = await resolveV2Source(reference, projectRoot, ref);
    const document = await readResolvedSource(resolved);
    if (document.kind === "pack") kinds.push("v2-pack");
    else kinds.push(document.manifest.schema === 1 ? "v1" : "v2-package");
  }
  return kinds;
}

async function handleAdd(parsed: Parsed, projectRoot: string): Promise<void> {
  if (parsed.positional.length === 0) throw new UsageError("add requires at least one source\n\n" + commandHelp("add"));
  const global = hasFlag(parsed, "global");
  const ref = parsed.values.get("ref");
  const id = parsed.values.get("id");
  const directory = parsed.values.get("dir");
  const agents = agentsValue(parsed);
  const alreadyV2 = await v2ConfigExists(projectRoot, global);
  if (global && agents && alreadyV2) throw new UsageError("--agents is accepted only while creating a global scope");
  const kinds = await inspectSources(parsed.positional, projectRoot, ref);
  const hasV1 = kinds.includes("v1");
  const hasV2 = kinds.some((kind) => kind !== "v1");
  if (hasV1 && hasV2) throw new UsageError("Cannot mix schema 1 and schema 2 sources in one add invocation");
  if (hasV1) {
    if (ref !== undefined) throw new UsageError("--ref is only supported for schema 2 sources");
    if (alreadyV2) throw new UsageError("Schema 1 sources cannot be added to a v2 scope; run migrate or use a schema 2 package");
    if (global && await v2ConfigExists(projectRoot, true)) throw new UsageError("Legacy operation overlaps an existing v2 global installation");
    if (id !== undefined || directory !== undefined || global) throw new UsageError("Legacy schema 1 add does not support v2 selection options");
    for (const reference of parsed.positional) {
      const result = await addPackage(reference, resolve(projectRoot));
      console.log(`Added ${result.id} at ${result.commit}`);
      for (const file of result.files) console.log(`  ${file}`);
    }
    return;
  }
  if (global && !alreadyV2 && agents) {
    await initV2({ projectRoot, global: true, agents, dryRun: hasFlag(parsed, "dry-run") });
  }
  const result = await addV2({
    projectRoot,
    global,
    references: parsed.positional,
    ...(ref === undefined ? {} : { ref }),
    ...(id === undefined ? {} : { id }),
    ...(directory === undefined ? {} : { directory }),
    ...(agents === undefined ? {} : { agents }),
    dryRun: hasFlag(parsed, "dry-run"),
  });
  for (const alias of result.ids) console.log(`${hasFlag(parsed, "dry-run") ? "Would add" : "Added"} ${alias}`);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  const projectRoot = resolve(process.cwd());
  if (command === "--help" || command === "-h" || command === undefined) {
    console.log(usage());
    return;
  }
  const commonFlags = new Set(["--global", "--dry-run", "--offline", "--adopt", "--update"]);
  const commonValues = new Set(["--ref", "--dir", "--id", "--agents"]);
  const parsed = parseArgs(args, commonFlags, commonValues);
  if (hasFlag(parsed, "help")) {
    console.log(commandHelp(command));
    return;
  }
  switch (command) {
    case "init":
      if (parsed.positional.length > 0) throw new UsageError("init accepts no positional arguments");
      if (hasFlag(parsed, "dir") || parsed.values.has("dir") || parsed.values.has("ref") || parsed.values.has("id")) throw new UsageError("init does not accept package selection options");
      await initV2({ projectRoot, global: hasFlag(parsed, "global"), adopt: hasFlag(parsed, "adopt"), agents: agentsValue(parsed), dryRun: hasFlag(parsed, "dry-run") });
      return;
    case "add":
      await handleAdd(parsed, projectRoot);
      return;
    case "remove":
      if (parsed.positional.length === 0) throw new UsageError("remove requires at least one alias");
      await removeV2({ projectRoot, global: hasFlag(parsed, "global"), ids: parsed.positional, dryRun: hasFlag(parsed, "dry-run") });
      return;
    case "render":
      if (parsed.positional.length > 0) throw new UsageError("render accepts no positional arguments");
      await renderV2({ projectRoot, global: hasFlag(parsed, "global"), offline: hasFlag(parsed, "offline") });
      return;
    case "diff":
      if (parsed.positional.length > 0) throw new UsageError("diff accepts no positional arguments");
      await diffV2({ projectRoot, global: hasFlag(parsed, "global"), update: hasFlag(parsed, "update") });
      return;
    case "update":
      await updateV2({ projectRoot, global: hasFlag(parsed, "global"), offline: hasFlag(parsed, "offline"), ids: parsed.positional, dryRun: hasFlag(parsed, "dry-run") });
      return;
    case "outdated": {
      if (parsed.positional.length > 0) throw new UsageError("outdated accepts no positional arguments");
      if (await outdatedV2({ projectRoot, global: hasFlag(parsed, "global") })) throw new ExitCodeError(1);
      return;
    }
    case "check":
      if (parsed.positional.length > 0) throw new UsageError("check accepts no positional arguments");
      await checkV2({ projectRoot, global: hasFlag(parsed, "global"), offline: hasFlag(parsed, "offline") });
      return;
    case "edit":
      if (parsed.positional.length > 0) throw new UsageError("edit accepts no positional arguments");
      if (hasFlag(parsed, "global") && parsed.values.has("dir")) throw new UsageError("--dir cannot be combined with --global");
      await editV2({ projectRoot, global: hasFlag(parsed, "global"), directory: parsed.values.get("dir") });
      return;
    case "migrate":
      if (parsed.positional.length > 0 || hasFlag(parsed, "global")) throw new UsageError("migrate supports project scope only");
      await migrateV1({ projectRoot, dryRun: hasFlag(parsed, "dry-run") });
      return;
    case "detect":
      if (parsed.positional.length > 0 || hasFlag(parsed, "global")) throw new UsageError("detect accepts no options or positional arguments");
      const { detectProject } = await import("./detect.js");
      console.log(await detectProject(projectRoot));
      return;
    default:
      throw new UsageError(`Unknown command: ${command}\n\n${usage()}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof ExitCodeError) {
    if (error.message) console.error(error.message);
    process.exitCode = error.code;
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
