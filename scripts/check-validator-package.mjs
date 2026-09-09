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

const expectedContractFiles = [
  "README.md",
  "examples/exception-grant-set-v1.json",
  "examples/manifest-evidence-v1.json",
  "examples/manifest-policy-v1.json",
  "examples/python-evidence-v1.json",
  "examples/python-policy-v1.json",
  "examples/repository-evidence-v1.json",
  "examples/repository-policy-v1.json",
  "examples/workflow-evidence-v1.json",
  "examples/workflow-policy-v1.json",
  "exception-grant-set-v1.schema.json",
  "malformed/exception-grant-set-private-data.json",
  "malformed/python-policy-unknown-field.json",
  "malformed/repository-evidence-source-content.json",
  "malformed/repository-policy-path-escape.json",
  "malformed/repository-policy-unknown-field.json",
  "manifest-evidence-v1.schema.json",
  "manifest-policy-v1.schema.json",
  "python-evidence-v1.schema.json",
  "python-policy-v1.schema.json",
  "python-profile-v1.md",
  "repository-evidence-v1.schema.json",
  "repository-policy-v1.schema.json",
  "workflow-evidence-v1.schema.json",
  "workflow-policy-v1.schema.json",
];

const expectedPackageFiles = [
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  ...expectedContractFiles.map((file) => `contracts/${file}`),
  "dist/kernel-zero-manifest.js",
  "dist/kernel-zero-python.js",
  "dist/kernel-zero-workflow.js",
  "dist/kernel-zero.js",
  "package.json",
  "python-analyzer.py",
].sort();

const work = await mkdtemp(path.join(tmpdir(), "kernel-zero-package-check-"));
try {
  const packDirectory = path.join(work, "pack");
  const consumer = path.join(work, "consumer");
  const fixture = path.join(work, "fixture");
  await Promise.all([
    mkdir(packDirectory, { recursive: true }),
    mkdir(path.join(fixture, "src"), { recursive: true }),
    mkdir(path.join(fixture, "python"), { recursive: true }),
    mkdir(path.join(fixture, ".github", "workflows"), { recursive: true }),
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
  const manifestPolicy = {
    apiVersion: "kernel-zero.dev/v1",
    kind: "ManifestPolicy",
    metadata: {
      description: "Package installation manifest smoke policy.",
      name: "package-smoke-manifest",
      revision: 1,
    },
    rules: [
      {
        check: { allowed: ["MIT"], kind: "allowed-licenses" },
        id: "allowed-license",
        level: "error",
        remediation: "Use an approved license.",
        title: "Approved license",
      },
      {
        check: { fields: ["dependencies", "devDependencies"], kind: "pinned-dependencies" },
        id: "pinned-dependencies",
        level: "error",
        remediation: "Pin dependency versions.",
        title: "Pinned dependencies",
      },
    ],
  };
  const workflowPolicy = {
    apiVersion: "kernel-zero.dev/v1",
    kind: "WorkflowPolicy",
    metadata: {
      description: "Package installation workflow smoke policy.",
      name: "package-smoke-workflow",
      revision: 1,
    },
    rules: [
      {
        check: { kind: "pinned-actions", mode: "tag" },
        id: "pinned-actions",
        level: "error",
        remediation: "Pin every action reference.",
        title: "Pinned actions",
      },
      {
        check: { allowWrite: [], kind: "restricted-permissions" },
        id: "restricted-permissions",
        level: "error",
        remediation: "Use read-only workflow permissions.",
        title: "Restricted permissions",
      },
    ],
    scope: { include: [".github/workflows/*.yml"] },
  };
  const pythonPolicy = {
    apiVersion: "kernel-zero.dev/v1",
    kind: "PythonPolicy",
    metadata: {
      description: "Package installation Python smoke policy.",
      name: "package-smoke-python",
      revision: 1,
    },
    rules: [
      {
        check: { deny: ["subprocess"], from: ["python/**/*.py"], kind: "forbid-import-edge" },
        id: "no-process-import",
        level: "error",
        remediation: "Use an isolated worker.",
        title: "No process imports",
      },
      {
        check: { files: ["python/**/*.py"], kind: "require-context-parameter", parameter: "workspace_id", symbols: "handler" },
        id: "workspace-context",
        level: "error",
        remediation: "Require workspace_id.",
        title: "Workspace context",
      },
    ],
    scope: { exclude: [], include: ["python/**/*.py"] },
  };
  await Promise.all([
    writeFile(path.join(fixture, "kernel-zero.policy.json"), `${JSON.stringify(policy, null, 2)}\n`, "utf8"),
    writeFile(path.join(fixture, "kernel-zero.manifest.policy.json"), `${JSON.stringify(manifestPolicy, null, 2)}\n`, "utf8"),
    writeFile(path.join(fixture, "kernel-zero.workflow.policy.json"), `${JSON.stringify(workflowPolicy, null, 2)}\n`, "utf8"),
    writeFile(path.join(fixture, "kernel-zero.python.policy.json"), `${JSON.stringify(pythonPolicy, null, 2)}\n`, "utf8"),
    writeFile(path.join(fixture, "package.json"), `${JSON.stringify({ name: "package-smoke", version: "1.0.0", license: "MIT", dependencies: { zod: "4.1.11" }, devDependencies: {} }, null, 2)}\n`, "utf8"),
    writeFile(path.join(fixture, "src", "index.ts"), "export const packageReady = true;\n", "utf8"),
    writeFile(path.join(fixture, ".github", "workflows", "ci.yml"), "name: CI\non: push\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n", "utf8"),
    writeFile(path.join(fixture, "python", "handler.py"), "import json\n\ndef handler(workspace_id, /):\n    return json.dumps({'workspace': workspace_id})\n", "utf8"),
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

  const manifestEvidencePath = path.join(fixture, ".kernel-zero", "manifest-evidence.json");
  runInstalledBinary(consumer, "kernel-zero-manifest", [
    "kernel-zero.manifest.policy.json",
    ".",
    "00000000-0000-7000-8000-000000000000",
    manifestEvidencePath,
  ], fixture);
  const manifestEvidence = JSON.parse(await readFile(manifestEvidencePath, "utf8"));
  if (manifestEvidence.kind !== "ManifestEvidence" || manifestEvidence.result?.status !== "pass" || manifestEvidence.result?.filesScanned !== 1) {
    throw new Error("Installed manifest validator did not produce expected passing evidence.");
  }

  const workflowEvidencePath = path.join(fixture, ".kernel-zero", "workflow-evidence.json");
  runInstalledBinary(consumer, "kernel-zero-workflow", [
    "kernel-zero.workflow.policy.json",
    ".",
    "00000000-0000-7000-8000-000000000000",
    workflowEvidencePath,
  ], fixture);
  const workflowEvidence = JSON.parse(await readFile(workflowEvidencePath, "utf8"));
  if (workflowEvidence.kind !== "WorkflowEvidence" || workflowEvidence.result?.status !== "pass" || workflowEvidence.result?.filesScanned !== 1) {
    throw new Error("Installed workflow validator did not produce expected passing evidence.");
  }

  const pythonEvidencePath = path.join(fixture, ".kernel-zero", "python-evidence.json");
  runInstalledBinary(consumer, "kernel-zero-python", [
    "kernel-zero.python.policy.json",
    ".",
    "00000000-0000-7000-8000-000000000000",
    pythonEvidencePath,
  ], fixture);
  const pythonEvidence = JSON.parse(await readFile(pythonEvidencePath, "utf8"));
  if (pythonEvidence.kind !== "PythonEvidence" || pythonEvidence.result?.status !== "pass" || pythonEvidence.result?.filesScanned !== 1) {
    throw new Error("Installed Python validator did not produce expected passing evidence.");
  }

  console.log(`validator package: pass (${artifact.filename}, ${String(artifact.entryCount)} files, 4 installed CLIs exit 0)`);
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

function runInstalledBinary(consumer, name, args, cwd) {
  const executable = path.join(
    consumer,
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${name}.cmd` : name,
  );
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`Installed ${name} exited ${String(result.status)}.\n${result.stdout}${result.stderr}`);
  }
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
  if (manifest.version !== "0.3.0") failures.push("version");
  if (manifest.private !== undefined) failures.push("private");
  if (manifest.exports !== undefined) failures.push("exports");
  if (manifest.optionalDependencies !== undefined) failures.push("optionalDependencies");
  if (manifest.bin?.["kernel-zero"] !== "dist/kernel-zero.js"
    || manifest.bin?.["kernel-zero-manifest"] !== "dist/kernel-zero-manifest.js"
    || manifest.bin?.["kernel-zero-python"] !== "dist/kernel-zero-python.js"
    || manifest.bin?.["kernel-zero-workflow"] !== "dist/kernel-zero-workflow.js") failures.push("bin");
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
