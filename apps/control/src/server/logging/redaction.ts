import "server-only";

const SENSITIVE_KEY = /authorization|cookie|credential|password|secret|token|action.?link|raw.?body|source.?line/iu;

export type SafeLogValue = boolean | number | string | null | readonly SafeLogValue[] | { readonly [key: string]: SafeLogValue };

export function redactForLog(value: unknown, depth = 0): SafeLogValue {
  if (depth > 5) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}[TRUNCATED]` : value;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactForLog(entry, depth + 1));
  if (typeof value !== "object") return "[UNSUPPORTED]";
  const output: Record<string, SafeLogValue> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactForLog(entry, depth + 1);
  }
  return output;
}
