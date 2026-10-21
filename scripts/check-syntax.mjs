import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

for (const directory of [".", "scripts", "tests", "functions"]) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && /\.(mjs|js)$/.test(entry.name)) execFileSync(process.execPath, ["--check", `${directory}/${entry.name}`], { stdio: "inherit" });
  }
}
