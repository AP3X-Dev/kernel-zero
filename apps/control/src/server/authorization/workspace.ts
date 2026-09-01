import "server-only";

import {
  appError,
  hasCapability,
  resolveStoredRoleDocument,
  type AppError,
  type Capability,
  type MembershipAuthority,
} from "@kernel-zero/domain";

export type WorkspaceAuthoritySource = Readonly<{
  capabilityDocument: unknown;
  isOwner: boolean;
}>;

export function workspaceAuthority(source: WorkspaceAuthoritySource): MembershipAuthority {
  return source.isOwner
    ? { isOwner: true }
    : { isOwner: false, role: resolveStoredRoleDocument(source.capabilityDocument) };
}

export function requireCapability(
  source: WorkspaceAuthoritySource,
  capability: Capability,
): AppError | null {
  return hasCapability(workspaceAuthority(source), capability) ? null : appError("FORBIDDEN");
}
