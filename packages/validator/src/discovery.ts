import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "bower_components",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "vendor",
]);

const SUPPORTED_GLOB_CHARACTERS = /^[^\\[\]{}!\0]+$/u;

export class DiscoveryError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DiscoveryError";
  }
}

export type ValidatorPathInput = Readonly<{
  custodyOut?: string;
  exceptions?: string;
  exceptionsTrustKey?: string;
  out: string;
  policy: string;
  policyApproval?: string;
  root: string;
  workspace: string;
  workspaceTrust?: string;
}>;

export type ResolvedValidatorPaths = Readonly<{
  custodyOut?: string;
  exceptions?: string;
  exceptionsTrustKey?: string;
  out: string;
  policy: string;
  policyApproval?: string;
  root: string;
  workspace: string;
  workspaceTrust?: string;
}>;

export type DiscoveryInput = Readonly<{
  exclude: readonly string[];
  include: readonly string[];
  languages: readonly ("typescript" | "tsx")[];
  root: string;
}>;

export type DiscoveredSource = Readonly<{
  absolutePath: string;
  bytes: Buffer;
  digest: `sha256:${string}`;
  path: string;
}>;

export type DiscoveryResult = Readonly<{
  files: readonly DiscoveredSource[];
  root: string;
}>;

export type ManifestDigestInput = Readonly<{
  digest: `sha256:${string}`;
  path: string;
}>;

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertContained(root: string, candidate: string, label: string): void {
  if (!isContained(root, candidate)) {
    throw new DiscoveryError(`${label} escapes the repository root.`);
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function resolveExistingFile(rootLexical: string, rootResolved: string, input: string, label: string): Promise<string> {
  const lexical = path.resolve(input);
  assertContained(rootLexical, lexical, label);

  let resolved: string;
  try {
    resolved = await realpath(lexical);
  } catch (error) {
    throw new DiscoveryError(`${label} is unreadable.`, { cause: error });
  }
  assertContained(rootResolved, resolved, label);

  const metadata = await lstat(resolved);
  if (!metadata.isFile()) {
    throw new DiscoveryError(`${label} must be a file.`);
  }
  return resolved;
}

async function resolveOutputFile(rootLexical: string, rootResolved: string, input: string): Promise<string> {
  const lexical = path.resolve(input);
  assertContained(rootLexical, lexical, "Output path");
  if (lexical === rootLexical) throw new DiscoveryError("Output path must be a file below the repository root.");

  let existingAncestor = lexical;
  const missingSegments: string[] = [];
  for (;;) {
    try {
      const metadata = await lstat(existingAncestor);
      if (existingAncestor === lexical && metadata.isDirectory()) {
        throw new DiscoveryError("Output path must not be a directory.");
      }
      break;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) throw new DiscoveryError("Output path has no existing contained ancestor.");
      missingSegments.unshift(path.basename(existingAncestor));
      existingAncestor = parent;
    }
  }

  let resolvedAncestor: string;
  try {
    resolvedAncestor = await realpath(existingAncestor);
  } catch (error) {
    throw new DiscoveryError("Output path is unreadable.", { cause: error });
  }
  assertContained(rootResolved, resolvedAncestor, "Output path");

  const resolved = path.join(resolvedAncestor, ...missingSegments);
  assertContained(rootResolved, resolved, "Output path");
  return resolved;
}

export async function resolveValidatorPaths(input: ValidatorPathInput): Promise<ResolvedValidatorPaths> {
  const rootLexical = path.resolve(input.root);
  let rootResolved: string;
  try {
    rootResolved = await realpath(rootLexical);
  } catch (error) {
    throw new DiscoveryError("Repository root is unreadable.", { cause: error });
  }
  const rootMetadata = await lstat(rootResolved);
  if (!rootMetadata.isDirectory()) throw new DiscoveryError("Repository root must be a directory.");

  const policy = await resolveExistingFile(rootLexical, rootResolved, input.policy, "Policy path");
  const out = await resolveOutputFile(rootLexical, rootResolved, input.out);
  let resolved: ResolvedValidatorPaths = { out, policy, root: rootResolved, workspace: input.workspace };
  if (input.exceptions !== undefined && input.exceptionsTrustKey !== undefined) {
    resolved = {
      ...resolved,
      exceptions: await resolveExistingFile(rootLexical, rootResolved, input.exceptions, "Exceptions path"),
      exceptionsTrustKey: await resolveExistingFile(rootLexical, rootResolved, input.exceptionsTrustKey, "Exceptions trust key path"),
    };
  }
  if (input.policyApproval !== undefined && input.workspaceTrust !== undefined && input.custodyOut !== undefined) {
    resolved = {
      ...resolved,
      custodyOut: await resolveOutputFile(rootLexical, rootResolved, input.custodyOut),
      policyApproval: await resolveExistingFile(rootLexical, rootResolved, input.policyApproval, "Policy approval path"),
      workspaceTrust: await resolveExistingFile(rootLexical, rootResolved, input.workspaceTrust, "Workspace trust path"),
    };
  }
  const outputs = [resolved.out, resolved.custodyOut].filter((value): value is string => value !== undefined);
  const inputs = [resolved.policy, resolved.exceptions, resolved.exceptionsTrustKey, resolved.policyApproval, resolved.workspaceTrust]
    .filter((value): value is string => value !== undefined);
  if (new Set(outputs).size !== outputs.length || outputs.some((output) => inputs.includes(output))) {
    throw new DiscoveryError("Output paths must be distinct from each other and from every input path.");
  }
  return resolved;
}

export function normalizeRelativePath(input: string): string {
  if (input.length === 0 || input.includes("\0") || path.posix.isAbsolute(input) || path.win32.isAbsolute(input)) {
    throw new DiscoveryError("Path must be a nonempty contained relative path.");
  }
  const normalized = input.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new DiscoveryError("Path must be a contained relative path without empty, dot, or parent segments.");
  }
  return normalized;
}

function compileGlob(pattern: string): RegExp {
  const normalized = normalizeRelativePath(pattern);
  if (!SUPPORTED_GLOB_CHARACTERS.test(normalized)) {
    throw new DiscoveryError(`Unsupported glob syntax: ${pattern}`);
  }

  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized.charAt(index);
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        if (normalized[index + 2] === "*") throw new DiscoveryError(`Unsupported glob syntax: ${pattern}`);
        index += 1;
        if (normalized[index + 1] === "/") {
          source += "(?:.*/)?";
          index += 1;
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    source += /[.$^+()|]/u.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`${source}$`, "u");
}

function validateLanguages(languages: readonly string[]): ReadonlySet<string> {
  if (languages.length === 0 || new Set(languages).size !== languages.length) {
    throw new DiscoveryError("Languages must be a nonempty unique list.");
  }
  for (const language of languages) {
    if (language !== "typescript" && language !== "tsx") {
      throw new DiscoveryError(`Unsupported language: ${language}`);
    }
  }
  return new Set(languages);
}

function languageMatches(relativePath: string, languages: ReadonlySet<string>): boolean {
  if (relativePath.endsWith(".tsx")) return languages.has("tsx");
  if (relativePath.endsWith(".ts")) return languages.has("typescript");
  return false;
}

function digestRawBytes(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function discoverTypeScriptSources(input: DiscoveryInput): Promise<DiscoveryResult> {
  let rootResolved: string;
  try {
    rootResolved = await realpath(path.resolve(input.root));
  } catch (error) {
    throw new DiscoveryError("Repository root is unreadable.", { cause: error });
  }
  const rootMetadata = await lstat(rootResolved);
  if (!rootMetadata.isDirectory()) throw new DiscoveryError("Repository root must be a directory.");
  if (input.include.length === 0) throw new DiscoveryError("At least one include glob is required.");

  const include = input.include.map(compileGlob);
  const exclude = input.exclude.map(compileGlob);
  const languages = validateLanguages(input.languages);
  const files: DiscoveredSource[] = [];

  async function visitDirectory(absoluteDirectory: string, logicalDirectory: string, ancestors: ReadonlySet<string>): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(absoluteDirectory);
    } catch (error) {
      throw new DiscoveryError(`Directory is unreadable: ${logicalDirectory || "."}`, { cause: error });
    }
    entries.sort(compareCodePoints);

    for (const name of entries) {
      const logicalPath = logicalDirectory === "" ? name : `${logicalDirectory}/${name}`;
      const absolutePath = path.join(absoluteDirectory, name);
      let metadata;
      try {
        metadata = await lstat(absolutePath);
      } catch (error) {
        throw new DiscoveryError(`Path is unreadable: ${logicalPath}`, { cause: error });
      }

      const directoryLike = metadata.isDirectory() || metadata.isSymbolicLink();
      if (directoryLike && IGNORED_DIRECTORY_NAMES.has(name.toLowerCase())) continue;

      let resolvedPath: string;
      try {
        resolvedPath = await realpath(absolutePath);
      } catch (error) {
        throw new DiscoveryError(`Path is unreadable: ${logicalPath}`, { cause: error });
      }
      assertContained(rootResolved, resolvedPath, `Path ${logicalPath}`);
      const resolvedMetadata = await lstat(resolvedPath);

      if (resolvedMetadata.isDirectory()) {
        if (ancestors.has(resolvedPath)) throw new DiscoveryError(`Directory symlink cycle detected: ${logicalPath}`);
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(resolvedPath);
        await visitDirectory(resolvedPath, logicalPath, nextAncestors);
        continue;
      }
      if (!resolvedMetadata.isFile()) continue;

      const normalizedPath = normalizeRelativePath(logicalPath);
      if (!languageMatches(normalizedPath, languages)) continue;
      if (!include.some((matcher) => matcher.test(normalizedPath))) continue;
      if (exclude.some((matcher) => matcher.test(normalizedPath))) continue;

      let bytes: Buffer;
      try {
        bytes = await readFile(resolvedPath);
      } catch (error) {
        throw new DiscoveryError(`Source file is unreadable: ${normalizedPath}`, { cause: error });
      }
      files.push({ absolutePath: resolvedPath, bytes, digest: digestRawBytes(bytes), path: normalizedPath });
    }
  }

  await visitDirectory(rootResolved, "", new Set([rootResolved]));
  files.sort((left, right) => compareCodePoints(left.path, right.path));
  return { files, root: rootResolved };
}

export function createManifestDigestInput(files: readonly DiscoveredSource[]): readonly ManifestDigestInput[] {
  return [...files]
    .sort((left, right) => compareCodePoints(left.path, right.path))
    .map((file) => ({ digest: file.digest, path: file.path }));
}
