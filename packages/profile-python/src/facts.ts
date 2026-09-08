import { z } from "zod";

import { FindingLocationSchema } from "@kernel-zero/contracts";

const RelativePythonPathSchema = z.string().min(1).max(1_000).superRefine((value, context) => {
  const segments = value.split("/");
  if (value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/u.test(value) || segments.includes("..") || !value.endsWith(".py")) {
    context.addIssue({ code: "custom", message: "Python fact paths must be contained relative POSIX .py paths." });
  }
});

const ImportFactSchema = z.strictObject({
  module: z.string().min(1).max(300),
  location: FindingLocationSchema,
});

const CallFactSchema = z.strictObject({
  callee: z.string().min(1).max(300),
  location: FindingLocationSchema,
});

const ParameterFactSchema = z.strictObject({
  kind: z.enum(["positional", "positional-only", "keyword-only", "vararg", "kwarg"]),
  name: z.string().min(1).max(200),
  required: z.boolean(),
});

const FunctionFactSchema = z.strictObject({
  location: FindingLocationSchema,
  name: z.string().min(1).max(500),
  parameters: z.array(ParameterFactSchema).max(500),
});

export const PythonFileFactsSchema = z.strictObject({
  calls: z.array(CallFactSchema).max(20_000),
  functions: z.array(FunctionFactSchema).max(20_000),
  imports: z.array(ImportFactSchema).max(20_000),
  parseError: FindingLocationSchema.nullable(),
  path: RelativePythonPathSchema,
});

export type PythonFileFacts = z.infer<typeof PythonFileFactsSchema>;

export const PythonAnalysisSchema = z.strictObject({
  files: z.array(PythonFileFactsSchema).max(5_000),
  protocolVersion: z.literal("kernel-zero.python-analysis/v1"),
  python: z.strictObject({
    implementation: z.literal("CPython"),
    version: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative()]),
  }),
});

export type PythonAnalysis = z.infer<typeof PythonAnalysisSchema>;
