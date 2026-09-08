import { createEvidenceSchema, type EvidenceMessages } from "@kernel-zero/contracts";
import { z } from "zod";

export const PYTHON_MESSAGE_CODES = Object.freeze([
  "PARSE_FAILURE",
  "PYTHON_CALL_RESTRICTED",
  "PYTHON_CONTEXT_PARAMETER_REQUIRED",
  "PYTHON_IMPORT_DENIED",
  "PYTHON_IMPORT_REQUIRED",
] as const);

export type PythonMessageCode = (typeof PYTHON_MESSAGE_CODES)[number];

export const pythonMessages: Readonly<Record<PythonMessageCode, string>> & EvidenceMessages = Object.freeze({
  PARSE_FAILURE: "A claimed Python source file could not be parsed.",
  PYTHON_CALL_RESTRICTED: "A restricted Python call was found outside its allowed location.",
  PYTHON_CONTEXT_PARAMETER_REQUIRED: "A governed Python function is missing a required context parameter.",
  PYTHON_IMPORT_DENIED: "A denied Python import edge was found.",
  PYTHON_IMPORT_REQUIRED: "A required Python module import is missing.",
});

const built = createEvidenceSchema({ evidenceKind: "PythonEvidence", toolName: "kernel-zero-python", messages: pythonMessages });

export const PythonEvidenceSchema = built.schema;
export type PythonEvidence = z.infer<typeof built.base>;

export function pythonEvidenceJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(built.schema, { io: "input", reused: "ref" });
}
