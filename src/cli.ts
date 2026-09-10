#!/usr/bin/env node

import { resolve } from "node:path";
import { addPackage, installPackages } from "./install.js";

function usage(): string {
  return `Usage: agents.md <command> [arguments]

Commands:
  add <source>         Add a Git-backed agent package
  install              Restore all declared project and global targets
`;
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  const projectRoot = process.cwd();

  switch (command) {
    case "add": {
      const reference = args[0];
      if (!reference) {
        throw new Error("add requires a package source\n\n" + usage());
      }
      const result = await addPackage(reference, resolve(projectRoot));
      console.log(`Added ${result.id} at ${result.commit}`);
      for (const file of result.files) {
        console.log(`  ${file}`);
      }
      return;
    }
    case "install": {
      const files = await installPackages(resolve(projectRoot));
      console.log(`Installed ${files.length} file${files.length === 1 ? "" : "s"}`);
      return;
    }
    case undefined:
      console.log(usage());
      return;
    default:
      throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
