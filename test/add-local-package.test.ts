import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { parse } from "yaml";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repositoryRoot, "src", "cli.ts");
const tsxLoader = join(repositoryRoot, "node_modules", "tsx", "dist", "loader.mjs");

async function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  return execFile(command, args, {
    cwd,
    env: { ...process.env, ...env },
  });
}

async function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return run(process.execPath, ["--import", tsxLoader, cliPath, ...args], cwd, env);
}

test("add installs package-declared project and global targets", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "agents-md-"));
  const packageRoot = join(fixtureRoot, "shared-package");
  const projectRoot = join(fixtureRoot, "consumer");
  const configRoot = join(fixtureRoot, "config");
  const homeRoot = join(fixtureRoot, "home");

  try {
    await mkdir(packageRoot, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    await mkdir(configRoot, { recursive: true });
    await mkdir(homeRoot, { recursive: true });

    await writeFile(
      join(packageRoot, "agent.yaml"),
      `schema: 1
name: shared-rules
description: Shared coding-agent instructions
canonical:
  source: AGENTS.md
files:
  - source: AGENTS.md
    targets:
      - scope: project
        path: AGENTS.md
        mode: direct
      - scope: project
        agent: claude-code
        path: CLAUDE.md
        mode: import
        import: AGENTS.md
      - scope: global
        agent: codex
        path: AGENTS.md
        mode: direct
`,
    );
    await writeFile(join(packageRoot, "AGENTS.md"), "# Shared rules\n\nUse TypeScript.\n");
    await writeFile(join(projectRoot, "AGENTS.md"), "# Existing project rules\n");
    await writeFile(join(projectRoot, "CLAUDE.md"), "# Existing Claude rules\n");
    await mkdir(join(homeRoot, ".codex"), { recursive: true });
    await writeFile(join(homeRoot, ".codex", "AGENTS.md"), "# Existing global rules\n");

    await run("git", ["init", "-b", "main"], packageRoot);
    await run("git", ["config", "user.email", "test@example.com"], packageRoot);
    await run("git", ["config", "user.name", "Agents Test"], packageRoot);
    await run("git", ["add", "agent.yaml", "AGENTS.md"], packageRoot);
    await run("git", ["commit", "-m", "fixture"], packageRoot);

    await runCli(["add", packageRoot], projectRoot, {
      AGENTS_CONFIG_DIR: configRoot,
      AGENTS_TEST_HOME: homeRoot,
    });

    assert.equal(
      await readFile(join(projectRoot, "AGENTS.md"), "utf8"),
      "# Shared rules\n\nUse TypeScript.\n",
    );
    assert.equal(await readFile(join(projectRoot, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
    assert.equal(
      await readFile(join(homeRoot, ".codex", "AGENTS.md"), "utf8"),
      "# Shared rules\n\nUse TypeScript.\n",
    );

    const projectManifest = parse(await readFile(join(projectRoot, "agents.yaml"), "utf8"));
    const globalManifest = parse(await readFile(join(configRoot, "global.yaml"), "utf8"));
    const globalLock = parse(await readFile(join(configRoot, "global.lock"), "utf8"));

    assert.equal(projectManifest.packages.length, 1);
    assert.equal(globalManifest.packages.length, 1);
    assert.equal(globalLock.packages["shared-rules"].scope, "global");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("add accepts a remote Git source", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "agents-md-remote-"));
  const packageRoot = join(fixtureRoot, "source");
  const bareRoot = join(fixtureRoot, "source.git");
  const projectRoot = join(fixtureRoot, "consumer");

  try {
    await mkdir(packageRoot, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      join(packageRoot, "agent.yaml"),
      `schema: 1
name: remote-rules
description: Rules from a remote Git repository
files:
  - AGENTS.md
`,
    );
    await writeFile(join(packageRoot, "AGENTS.md"), "# Remote rules\n");

    await run("git", ["init", "-b", "main"], packageRoot);
    await run("git", ["config", "user.email", "test@example.com"], packageRoot);
    await run("git", ["config", "user.name", "Agents Test"], packageRoot);
    await run("git", ["add", "agent.yaml", "AGENTS.md"], packageRoot);
    await run("git", ["commit", "-m", "fixture"], packageRoot);
    await run("git", ["clone", "--bare", packageRoot, bareRoot], fixtureRoot);

    await runCli(["add", `file://${bareRoot}`], projectRoot, {
      AGENTS_CONFIG_DIR: join(fixtureRoot, "config"),
      AGENTS_TEST_HOME: join(fixtureRoot, "home"),
    });

    assert.equal(await readFile(join(projectRoot, "AGENTS.md"), "utf8"), "# Remote rules\n");
    const lock = parse(await readFile(join(projectRoot, "agents.lock"), "utf8"));
    const locked = lock.packages["remote-rules"];
    assert.equal(locked.source.url, `file://${bareRoot}`);
    assert.match(locked.commit, /^[0-9a-f]{40}$/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
