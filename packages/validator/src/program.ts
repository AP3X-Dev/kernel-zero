import path from "node:path";

import ts from "typescript";

export interface RepositoryProgram {
  readonly rootPath: string;
  readonly filePaths: readonly string[];
  readonly program: ts.Program;
  readonly sourceFiles: ReadonlyMap<string, ts.SourceFile>;
  readonly parseDiagnostics: ReadonlyMap<string, readonly ts.Diagnostic[]>;
}

export interface CreateRepositoryProgramOptions {
  readonly rootPath: string;
  readonly filePaths: readonly string[];
  readonly compilerOptions?: ts.CompilerOptions;
}

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: false,
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
};

export class RepositoryProgramError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RepositoryProgramError";
  }
}

export function createRepositoryProgram(options: CreateRepositoryProgramOptions): RepositoryProgram {
  const rootPath = path.resolve(options.rootPath);
  const filePaths = [...new Set(options.filePaths.map((filePath) => normalizeContainedPath(rootPath, filePath)))].sort();
  const absoluteFiles = filePaths.map((filePath) => path.join(rootPath, ...filePath.split("/")));
  const compilerOptions = { ...DEFAULT_COMPILER_OPTIONS, ...options.compilerOptions, noEmit: true };
  const program = ts.createProgram({ rootNames: absoluteFiles, options: compilerOptions });
  const sourceFiles = new Map<string, ts.SourceFile>();
  const parseDiagnostics = new Map<string, readonly ts.Diagnostic[]>();

  for (const [index, absoluteFile] of absoluteFiles.entries()) {
    const filePath = filePaths[index];
    if (filePath === undefined) {
      throw new RepositoryProgramError("A normalized repository path could not be paired with its source file.");
    }
    const sourceFile = program.getSourceFile(absoluteFile);
    if (sourceFile === undefined) {
      throw new RepositoryProgramError(`Repository input is unreadable: ${filePath}`);
    }
    sourceFiles.set(filePath, sourceFile);
    parseDiagnostics.set(filePath, program.getSyntacticDiagnostics(sourceFile));
  }

  return { rootPath, filePaths, program, sourceFiles, parseDiagnostics };
}

export function resolveRepositoryModule(repository: RepositoryProgram, sourceFile: ts.SourceFile, specifier: string): string | undefined {
  const resolved = ts.resolveModuleName(
    specifier,
    sourceFile.fileName,
    repository.program.getCompilerOptions(),
    ts.sys,
  ).resolvedModule?.resolvedFileName;
  if (resolved === undefined) {
    return undefined;
  }
  return containedRelativePath(repository.rootPath, resolved);
}

function normalizeContainedPath(rootPath: string, filePath: string): string {
  const posixPath = filePath.replaceAll("\\", "/");
  if (posixPath.length === 0 || path.posix.isAbsolute(posixPath) || /^[A-Za-z]:/u.test(posixPath)) {
    throw new RepositoryProgramError(`Repository input must be a contained relative path: ${filePath}`);
  }
  const normalized = path.posix.normalize(posixPath);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("\0")) {
    throw new RepositoryProgramError(`Repository input must be a contained relative path: ${filePath}`);
  }
  const absolutePath = path.resolve(rootPath, ...normalized.split("/"));
  if (containedRelativePath(rootPath, absolutePath) === undefined) {
    throw new RepositoryProgramError(`Repository input must be a contained relative path: ${filePath}`);
  }
  return normalized;
}

export function containedRelativePath(rootPath: string, absolutePath: string): string | undefined {
  const relative = path.relative(rootPath, path.resolve(absolutePath));
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.replaceAll("\\", "/");
}
