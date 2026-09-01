import "server-only";

const FALLBACK_CALLBACK = "/app";

export function safeLocalCallback(value: string | null | undefined): string {
  if (value === null || value === undefined) return FALLBACK_CALLBACK;
  const candidate = value.trim();
  if (candidate.length === 0 || !candidate.startsWith("/")) return FALLBACK_CALLBACK;
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return FALLBACK_CALLBACK;

  for (let index = 0; index < candidate.length; index += 1) {
    const code = candidate.charCodeAt(index);
    if (code <= 32 || code === 127) return FALLBACK_CALLBACK;
  }
  return candidate;
}
