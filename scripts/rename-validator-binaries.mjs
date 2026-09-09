import { chmod, copyFile, cp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "packages", "validator");
const dist = path.join(packageRoot, "dist");
const binaries = [
  ["cli.js", "kernel-zero.js"],
  ["run-manifest-validator.js", "kernel-zero-manifest.js"],
  ["run-python-validator.js", "kernel-zero-python.js"],
  ["run-workflow-validator.js", "kernel-zero-workflow.js"],
];

for (const [source, target] of binaries) {
  const output = path.join(dist, target);
  await rename(path.join(dist, source), output);
  await chmod(output, 0o755);
}

await copyFile(
  path.resolve(packageRoot, "..", "profile-python", "python-analyzer.py"),
  path.join(packageRoot, "python-analyzer.py"),
);

const contracts = path.join(packageRoot, "contracts");
await rm(contracts, { force: true, recursive: true });
await cp(path.resolve(packageRoot, "..", "..", "docs", "contracts"), contracts, { recursive: true });
