import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const workspaces = Object.freeze({
  "@kernel-zero/control": "apps/control",
  "@kernel-zero/contracts": "packages/contracts",
  "@kernel-zero/domain": "packages/domain",
  "@kernel-zero/persistence": "packages/persistence",
  "@kernel-zero/profile-manifest": "packages/profile-manifest",
  "@kernel-zero/profile-software-architecture": "packages/profile-software-architecture",
  "@kernel-zero/profiles": "packages/profiles",
  "@kernel-zero/testing": "packages/testing",
  "@kernel-zero/validator": "packages/validator",
});

const allowedWorkspaceDependencies = Object.freeze({
  "@kernel-zero/control": new Set([
    "@kernel-zero/contracts",
    "@kernel-zero/domain",
    "@kernel-zero/persistence",
    "@kernel-zero/profiles",
  ]),
  "@kernel-zero/contracts": new Set(["@kernel-zero/domain"]),
  "@kernel-zero/domain": new Set(),
  "@kernel-zero/persistence": new Set([
    "@kernel-zero/contracts",
    "@kernel-zero/domain",
  ]),
  "@kernel-zero/profile-manifest": new Set([
    "@kernel-zero/contracts",
    "@kernel-zero/domain",
  ]),
  "@kernel-zero/profile-software-architecture": new Set([
    "@kernel-zero/contracts",
    "@kernel-zero/domain",
  ]),
  "@kernel-zero/profiles": new Set([
    "@kernel-zero/contracts",
    "@kernel-zero/profile-manifest",
    "@kernel-zero/profile-software-architecture",
  ]),
  "@kernel-zero/testing": new Set([
    "@kernel-zero/contracts",
    "@kernel-zero/domain",
  ]),
  "@kernel-zero/validator": new Set([
    "@kernel-zero/contracts",
    "@kernel-zero/domain",
    "@kernel-zero/profile-software-architecture",
  ]),
});

const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/gu;

function listSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(absolute));
    } else if (/\.[cm]?[jt]sx?$/u.test(entry.name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files.sort();
}

function workspaceSpecifier(specifier) {
  return Object.keys(workspaces).find(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );
}

function importsFrom(source) {
  const imports = [];
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) imports.push(specifier);
  }
  return imports;
}

function relativePath(path) {
  return relative(repositoryRoot, path).split(sep).join("/");
}

export function evaluateArchitecture() {
  const violations = [];

  for (const [workspaceName, workspaceDirectory] of Object.entries(workspaces)) {
    const root = join(repositoryRoot, workspaceDirectory);
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const declared = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
    };

    if (manifest.name !== workspaceName) {
      violations.push(`${workspaceDirectory}/package.json declares an unexpected package name`);
    }

    if (workspaceName === "@kernel-zero/domain" && Object.keys(declared).length > 0) {
      violations.push("packages/domain must have no runtime package dependencies");
    }

    for (const dependency of Object.keys(declared).filter((name) => name in workspaces)) {
      if (!allowedWorkspaceDependencies[workspaceName].has(dependency)) {
        violations.push(`${workspaceName} may not declare ${dependency}`);
      }
    }

    const sourceRoot = join(root, "src");
    for (const file of listSourceFiles(sourceRoot)) {
      const source = readFileSync(file, "utf8");
      const fileLabel = relativePath(file);
      for (const specifier of importsFrom(source)) {
        const internal = workspaceSpecifier(specifier);
        if (internal !== undefined && !allowedWorkspaceDependencies[workspaceName].has(internal)) {
          violations.push(`${fileLabel} imports forbidden workspace ${internal}`);
        }
        if (internal !== undefined && !(internal in declared)) {
          violations.push(`${fileLabel} imports undeclared workspace ${internal}`);
        }
        if (specifier === "@prisma/client" && workspaceName !== "@kernel-zero/persistence") {
          violations.push(`${fileLabel} imports the raw database client outside persistence`);
        }
        if (
          workspaceName === "@kernel-zero/control" &&
          (specifier === "node:child_process" || specifier === "node:worker_threads")
        ) {
          violations.push(`${fileLabel} imports a forbidden execution API`);
        }
      }

      const mustBeServerOnly =
        workspaceName === "@kernel-zero/persistence" ||
        fileLabel.startsWith("apps/control/src/server/");
      if (mustBeServerOnly && !/^\s*import\s+["']server-only["'];/mu.test(source)) {
        violations.push(`${fileLabel} is server code without a server-only marker`);
      }
    }
  }

  return violations.sort();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const violations = evaluateArchitecture();
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`architecture: ${violation}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("architecture: dependency and server-only boundaries pass\n");
  }
}
