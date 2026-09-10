import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { PackageTarget } from "./types.js";

export function userHome(): string {
  return process.env.AGENTS_TEST_HOME ?? homedir();
}

export function configDirectory(): string {
  if (process.env.AGENTS_CONFIG_DIR) {
    return process.env.AGENTS_CONFIG_DIR;
  }

  const home = userHome();
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "agents");
  }
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "agents");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "agents");
}

export function globalAgentRoot(agent: string): string {
  const roots: Record<string, string> = {
    "claude-code": ".claude",
    codex: ".codex",
    cursor: ".cursor",
    "github-copilot": join(".config", "github-copilot"),
    "gemini-cli": ".gemini",
  };
  const relativeRoot = roots[agent];
  if (!relativeRoot) {
    throw new Error(`No target adapter is installed for agent: ${agent}`);
  }
  return join(userHome(), relativeRoot);
}

export function destinationForTarget(target: PackageTarget, projectRoot: string): string {
  const root = target.scope === "project" ? projectRoot : globalAgentRoot(target.agent!);
  return join(root, ...target.path.split("/"));
}
