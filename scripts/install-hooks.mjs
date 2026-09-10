import { spawnSync } from "node:child_process";

const executable = process.platform === "win32" ? "lefthook.cmd" : "lefthook";
const result = spawnSync(executable, ["install"], {
  stdio: ["ignore", "ignore", "inherit"],
});

if (result.error) {
  console.error(`Unable to install Lefthook: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
