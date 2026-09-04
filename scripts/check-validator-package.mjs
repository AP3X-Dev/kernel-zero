import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (npmCli === undefined || npmCli.length === 0) {
  throw new Error("Run this check through npm so npm_execpath is available.");
}

const expectedPackageFiles = [
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "dist/kernel-zero.js",
  "package.json",
];

const work = await mkdtemp(path.join(tmpdir(), "kernel-zero-package-check-"));
try {
  const packDirectory = path.join(work, "pack");
  const consumer = path.join(work, "consumer");
  const fixture = path.join(work, "fixture");
  await Promise.all([
    mkdir(packDirectory, { recursive: true }),
    mkdir(path.join(fixture, "src"), { recursive: true }),
  ]);

  const pack = runNpm([
    "pack",
    "--json",
    "--workspace",
    "@kernel-zero/validator",
    "--pack-destination",
    packDirectory,
  ], root, true);
  const packed = parsePackJson(pack.stdout);
  if (packed.length !== 1 || packed[0] === undefined) {
    throw new Error(`Expected one packed package, received ${packed.length}.`);
  }
  const artifact = packed[0];
  const packedFiles = artifact.files.map(({ path: file }) => file).sort();
  assertEqual(packedFiles, expectedPackageFiles, "packed file set");

  const tarball = path.join(packDirectory, artifact.filename);
  runNpm([
    "install",
    "--prefix",
    consumer,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarball,
  ], root, false);

  const packageRoot = path.join(consumer, "node_modules", "@kernel-zero", "validator");
  const installedFiles = (await listFiles(packageRoot)).sort();
  assertEqual(installedFiles, expectedPackageFiles, "installed file set");

  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  assertManifest(manifest);

  const policy = {
    apiVersion: "kernel-zero.dev/v1",
    kind: "RepositoryPolicy",
    metadata: {
      description: "Package installation smoke policy.",
      name: "package-smoke-policy",
      revision: 1,
    },
    rules: [{
      check: {
        deny: ["module:@prisma/client"],
        from: ["src/**/*.ts"],
        kind: "forbid-import-edge",
      },
      id: "no-raw-prisma",
      level: "error",
      remediation: "Use an application boundary.",
      title: "No raw Prisma",
    }],
    scope: {
      exclude: [],
      include: ["src/**/*.ts"],
      languages: ["typescript"],
    },
  };
  await Promise.all([
    writeFile(path.join(fixture, "kernel-zero.policy.json"), `${JSON.stringify(policy, null, 2)}\n`, "utf8"),
    writeFile(path.join(fixture, "src", "index.ts"), "export const packageReady = true;\n", "utf8"),
  ]);

  const evidencePath = path.join(fixture, ".kernel-zero", "evidence.json");
  const executable = path.join(
    consumer,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "kernel-zero.cmd" : "kernel-zero",
  );
  const validation = spawnSync(executable, [
    "validate",
    "--policy",
    "kernel-zero.policy.json",
    "--root",
    ".",
    "--workspace",
    "00000000-0000-7000-8000-000000000000",
    "--out",
    evidencePath,
  ], {
    cwd: fixture,
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (validation.status !== 0) {
    throw new Error(`Installed validator exited ${String(validation.status)}.\n${validation.stdout}${validation.stderr}`);
  }
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  if (evidence.result?.status !== "pass" || evidence.result?.filesScanned !== 1) {
    throw new Error("Installed validator did not produce the expected passing one-file evidence.");
  }

  console.log(`validator package: pass (${artifact.filename}, ${String(artifact.entryCount)} files, installed CLI exit 0)`);
} finally {
  await rm(work, { force: true, recursive: true });
}

function runNpm(args, cwd, capture) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} exited ${String(result.status)}.\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return result;
}

function parsePackJson(stdout) {
  const trimmed = stdout.trim();
  const start = trimmed.lastIndexOf("\n[");
  return JSON.parse(start === -1 ? trimmed : trimmed.slice(start + 1));
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

function assertManifest(manifest) {
  const failures = [];
  if (manifest.name !== "@kernel-zero/validator") failures.push("name");
  if (manifest.version !== "0.1.0") failures.push("version");
  if (manifest.private !== undefined) failures.push("private");
  if (manifest.exports !== undefined) failures.push("exports");
  if (manifest.optionalDependencies !== undefined) failures.push("optionalDependencies");
  if (manifest.bin?.["kernel-zero"] !== "dist/kernel-zero.js") failures.push("bin");
  if (manifest.license !== "MIT") failures.push("license");
  if (manifest.engines?.node !== ">=22 <23") failures.push("engines.node");
  if (manifest.publishConfig?.access !== "public") failures.push("publishConfig.access");
  if (manifest.dependencies?.typescript !== "5.9.3") failures.push("dependencies.typescript");
  if (manifest.repository?.directory !== "packages/validator") failures.push("repository.directory");
  if (failures.length > 0) throw new Error(`Invalid packed manifest fields: ${failures.join(", ")}.`);
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected ${label}.\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}
