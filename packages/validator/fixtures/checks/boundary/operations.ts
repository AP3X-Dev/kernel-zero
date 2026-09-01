declare const Input: {
  parse(value: unknown): { workspaceId: string };
  safeParse(value: unknown):
    | { success: true; data: { workspaceId: string } }
    | { success: false; error: Error };
};
declare function persist(input: { workspaceId: string }): void;

export function direct(raw: unknown): void {
  persist(Input.parse(raw));
}

export function prior(raw: unknown): void {
  const parsed = Input.parse(raw);
  persist(parsed);
}

export function guarded(raw: unknown): void {
  const result = Input.safeParse(raw);
  if (result.success) {
    persist(result.data);
  }
}

export function unsafe(raw: unknown): void {
  persist(raw as { workspaceId: string });
}
