interface GoodInput {
  workspaceId: string;
}

interface OptionalInput {
  workspaceId?: string;
}

export function direct(workspaceId: string): string {
  return workspaceId;
}

export function typed(input: GoodInput): string {
  return input.workspaceId;
}

export function missing(_input: OptionalInput): void {}

export const handlers = {
  invalid(_input: any): void {},
};
