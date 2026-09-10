import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { parse } from "yaml";
import { parseConsumerConfigBytes, parsePackageManifestBytes } from "../src/manifest.js";
import { detectProjectData } from "../src/detect.js";
import { applyTransaction } from "../src/transaction.js";
import { createSourceResolutionCache, readCachedFile, resolveV2Source } from "../src/git.js";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repositoryRoot, "src", "cli.ts");
const tsxLoader = join(repositoryRoot, "node_modules", "tsx", "dist", "loader.mjs");

async function run(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const result = await execFile(command, args, { cwd, maxBuffer: 8 * 1024 * 1024 });
  return result;
}

async function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return execFile(process.execPath, ["--import", tsxLoader, cliPath, ...args], {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function gitRepo(root: string, files: Record<string, string>): Promise<{ root: string; commit: string }> {
  await mkdir(root, { recursive: true });
  for (const [path, body] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, body);
  }
  await run("git", ["init", "-b", "main"], root);
  await run("git", ["config", "user.email", "test@example.com"], root);
  await run("git", ["config", "user.name", "Agents Test"], root);
  await run("git", ["add", "."], root);
  await run("git", ["commit", "-m", "fixture"], root);
  const commit = (await run("git", ["rev-parse", "HEAD"], root)).stdout.trim();
  return { root, commit };
}

function packageManifest(name: string, source: string, title: string): string {
  return `schema: 2\nname: ${name}\ndescription: ${name} rules\nfragments:\n  - id: main\n    source: ${source}\n    title: ${title}\n`;
}

test("v2 composes stable output, excludes fragments, and keeps nested output isolated", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "agents-md-v2-"));
  try {
    const source = await gitRepo(join(fixture, "source"), {
      "packages/express/agent.yaml": packageManifest("express", "routing.md", "Routing"),
      "packages/express/routing.md": "# Routing\r\n\nKeep transport thin.\r\n",
      "packages/mysql/agent.yaml": packageManifest("mysql", "mysql.md", "MySQL"),
      "packages/mysql/mysql.md": "# MySQL\n\nReview indexes.\n",
    });
    const consumer = join(fixture, "consumer");
    await mkdir(consumer, { recursive: true });
    const env = { AGENTS_CONFIG_DIR: join(fixture, "config"), AGENTS_TEST_HOME: join(fixture, "home") };
    await runCli(["init"], consumer, env);
    await runCli(["add", `file://${source.root}#packages/express`], consumer, env);
    await runCli(["add", `file://${source.root}#packages/mysql`, "--dir", "services/api"], consumer, env);
    await writeFile(join(consumer, ".agents", "project.md"), "# Local notes\n");
    await runCli(["render"], consumer, env);
    const rootBody = await readFile(join(consumer, "AGENTS.md"), "utf8");
    assert.match(rootBody, /express\/main/);
    assert.doesNotMatch(rootBody, /mysql\/main/);
    assert.match(await readFile(join(consumer, "services/api/AGENTS.md"), "utf8"), /mysql\/main/);
    assert.equal(await readFile(join(consumer, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
    await runCli(["check"], consumer, env);
    const before = await readFile(join(consumer, "AGENTS.md"));
    await runCli(["add", `file://${source.root}#packages/express`], consumer, env);
    assert.deepEqual(await readFile(join(consumer, "AGENTS.md")), before);
    const config = parse(await readFile(join(consumer, "agents.yaml"), "utf8")) as { outputs: Array<{ directory: string; use: string[] }> };
    assert.deepEqual(config.outputs.find((output) => output.directory === ".")?.use, ["express"]);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("v2 pack installs remain checkable after config parsing", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "agents-md-pack-check-"));
  try {
    const source = await gitRepo(join(fixture, "source"), {
      "packages/one/agent.yaml": packageManifest("one", "rules.md", "One"),
      "packages/one/rules.md": "# One\n\nKeep one concern per module.\n",
      "packages/two/agent.yaml": packageManifest("two", "rules.md", "Two"),
      "packages/two/rules.md": "# Two\n\nKeep transport thin.\n",
      "packs/stack/agents.yaml": "version: 2\nkind: pack\nname: stack\npackages:\n  - id: one\n    source: ../../packages/one\n  - id: two\n    source: ../../packages/two\noutputs:\n  - directory: .\n    use: [one, two]\n    exclude: []\n",
    });
    const consumer = join(fixture, "consumer");
    await mkdir(consumer, { recursive: true });
    const env = { AGENTS_CONFIG_DIR: join(fixture, "config"), AGENTS_TEST_HOME: join(fixture, "home") };
    await runCli(["init"], consumer, env);
    await runCli(["add", `file://${source.root}#packs/stack`, "--ref", "main"], consumer, env);
    await runCli(["check"], consumer, env);
    assert.match(await readFile(join(consumer, "AGENTS.md"), "utf8"), /stack\/one\/main/);
    assert.match(await readFile(join(consumer, "AGENTS.md"), "utf8"), /stack\/two\/main/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("v2 locks immutable bytes and update sees a new commit", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "agents-md-lock-"));
  try {
    const source = await gitRepo(join(fixture, "source"), {
      "agent.yaml": packageManifest("rules", "rules.md", "Rules"),
      "rules.md": "A\n",
    });
    const consumer = join(fixture, "consumer");
    await mkdir(consumer, { recursive: true });
    const env = { AGENTS_CONFIG_DIR: join(fixture, "config"), AGENTS_TEST_HOME: join(fixture, "home") };
    await runCli(["add", `file://${source.root}`], consumer, env);
    await writeFile(join(source.root, "rules.md"), "B\n");
    await run("git", ["add", "rules.md"], source.root);
    await run("git", ["commit", "-m", "second"], source.root);
    await writeFile(join(source.root, "rules.md"), "DIRTY\n");
    await runCli(["render", "--offline"], consumer, env);
    assert.match(await readFile(join(consumer, "AGENTS.md"), "utf8"), /A\n/);
    await assert.rejects(runCli(["outdated"], consumer, env));
    await runCli(["update"], consumer, env);
    assert.match(await readFile(join(consumer, "AGENTS.md"), "utf8"), /B\n/);
    assert.doesNotMatch(await readFile(join(consumer, "AGENTS.md"), "utf8"), /DIRTY/);
    await runCli(["check"], consumer, env);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("same repository refs share one immutable snapshot during an operation", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "agents-md-snapshot-"));
  const previousConfigDirectory = process.env.AGENTS_CONFIG_DIR;
  try {
    const source = await gitRepo(join(fixture, "source"), {
      "packages/one/agent.yaml": packageManifest("one", "rules.md", "One"),
      "packages/one/rules.md": "A\n",
      "packages/two/agent.yaml": packageManifest("two", "rules.md", "Two"),
      "packages/two/rules.md": "B\n",
    });
    const consumer = join(fixture, "consumer");
    await mkdir(consumer, { recursive: true });
    process.env.AGENTS_CONFIG_DIR = join(fixture, "config");
    const cache = createSourceResolutionCache();
    const first = await resolveV2Source("../source#packages/one", consumer, undefined, true, cache);
    await writeFile(join(source.root, "after-first-resolution.txt"), "changed after snapshot\n");
    await run("git", ["add", "after-first-resolution.txt"], source.root);
    await run("git", ["commit", "-m", "move head"], source.root);
    const second = await resolveV2Source("../source#packages/two", consumer, undefined, true, cache);
    assert.equal(second.commit, first.commit);
    assert.equal((await readCachedFile(first.root, "rules.md")).toString("utf8"), "A\n");
    assert.equal((await readCachedFile(second.root, "rules.md")).toString("utf8"), "B\n");
  } finally {
    if (previousConfigDirectory === undefined) delete process.env.AGENTS_CONFIG_DIR;
    else process.env.AGENTS_CONFIG_DIR = previousConfigDirectory;
    await rm(fixture, { recursive: true, force: true });
  }
});

test("v2 parser rejects unknown fields, duplicate aliases, unsafe paths, and unknown versions", () => {
  assert.throws(() => parsePackageManifestBytes("schema: 3\nname: x\ndescription: x\nfragments: []\n"), /schema must be 1 or 2/);
  assert.throws(() => parsePackageManifestBytes("schema: 2\nname: x\ndescription: x\nwat: true\nfragments: []\n"), /unknown field wat/);
  assert.throws(() => parseConsumerConfigBytes(`version: 2\npackages:\n- id: x\n  source: github:a/b\n- id: x\n  source: github:c/d\npacks: []\noutputs: []\n`), /duplicate alias/);
  assert.throws(() => parseConsumerConfigBytes(`version: 2\npackages: []\npacks: []\noutputs:\n- directory: ../escape\n  use: []\n  local: []\n`), /safe relative directory/);
});

test("transaction rollback restores all destinations after a caught apply failure", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "agents-md-transaction-"));
  try {
    await assert.rejects(
      applyTransaction({
        writes: [
          { path: join(fixture, "a"), contents: Buffer.from("first\n"), expectedSha256: null },
          { path: join(fixture, "a", "b"), contents: Buffer.from("second\n"), expectedSha256: null },
        ],
        lockPath: join(fixture, ".agents", ".operation.lock"),
        journalPath: join(fixture, ".agents", ".recovery.json"),
        boundary: fixture,
      }),
      /ENOTDIR/,
    );
    await assert.rejects(readFile(join(fixture, "a")));
    await assert.rejects(readFile(join(fixture, ".agents", ".recovery.json")));
    await assert.rejects(readFile(join(fixture, ".agents", ".operation.lock")));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("detect reports static workspace evidence without executing or writing", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "agents-md-detect-"));
  try {
    await writeFile(join(fixture, "package.json"), JSON.stringify({ workspaces: ["packages/*"], devDependencies: { typescript: "^5" }, dependencies: { express: "^5" } }));
    await mkdir(join(fixture, "packages", "api"), { recursive: true });
    await writeFile(join(fixture, "packages", "api", "package.json"), JSON.stringify({ dependencies: { hono: "^4", mysql2: "^3" } }));
    await writeFile(join(fixture, "tsconfig.json"), "{}\n");
    const result = await detectProjectData(fixture);
    assert.deepEqual([...new Set(result.evidence.map((item) => item.technology))].sort(), ["Express", "Hono", "MySQL", "TypeScript"].sort());
    assert.equal(result.errors.length, 0);
    await assert.rejects(readFile(join(fixture, "agents.yaml")));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
