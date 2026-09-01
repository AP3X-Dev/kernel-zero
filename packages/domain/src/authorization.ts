import { appError, type AppError } from "./errors";
import { err, ok, type Result } from "./result";

export const CAPABILITIES = Object.freeze([
  "workspace.read",
  "workspace.update",
  "workspace.delete",
  "workspace.transfer",
  "member.read",
  "member.invite",
  "member.update",
  "member.remove",
  "role.read",
  "role.manage",
  "policy.read",
  "policy.write",
  "policy.approve",
  "policy.activate",
  "policy.retire",
  "evidence.read",
  "evidence.submit",
  "evidence.signing-key.manage",
  "exception.read",
  "exception.request",
  "exception.decide",
  "exception.revoke",
  "billing.read",
  "billing.manage",
  "audit.read",
] as const);

export type Capability = (typeof CAPABILITIES)[number];

const capabilitySet: ReadonlySet<string> = new Set(CAPABILITIES);

export const CAPABILITY_GROUP_NAMES = Object.freeze([
  "workspace",
  "member",
  "role",
  "policy",
  "evidence",
  "exception",
  "billing",
  "audit",
] as const);

export type CapabilityGroupName = (typeof CAPABILITY_GROUP_NAMES)[number];
export type CapabilityGroups = Readonly<Record<CapabilityGroupName, readonly Capability[]>>;

const freezeCapabilities = (values: readonly Capability[]): readonly Capability[] =>
  Object.freeze([...values]);

export const ALL_CAPABILITIES_BY_GROUP: CapabilityGroups = Object.freeze({
  audit: freezeCapabilities(["audit.read"]),
  billing: freezeCapabilities(["billing.read", "billing.manage"]),
  evidence: freezeCapabilities([
    "evidence.read",
    "evidence.submit",
    "evidence.signing-key.manage",
  ]),
  exception: freezeCapabilities([
    "exception.read",
    "exception.request",
    "exception.decide",
    "exception.revoke",
  ]),
  member: freezeCapabilities([
    "member.read",
    "member.invite",
    "member.update",
    "member.remove",
  ]),
  policy: freezeCapabilities([
    "policy.read",
    "policy.write",
    "policy.approve",
    "policy.activate",
    "policy.retire",
  ]),
  role: freezeCapabilities(["role.read", "role.manage"]),
  workspace: freezeCapabilities([
    "workspace.read",
    "workspace.update",
    "workspace.delete",
    "workspace.transfer",
  ]),
});

export const BUILT_IN_ROLE_LABELS = Object.freeze([
  "owner",
  "administrator",
  "policy_author",
  "reviewer",
  "observer",
] as const);

export type BuiltInRoleLabel = (typeof BUILT_IN_ROLE_LABELS)[number];
export type DefaultRoleProfileLabel = Exclude<BuiltInRoleLabel, "owner">;

const reservedRoleLabels: ReadonlySet<string> = new Set(BUILT_IN_ROLE_LABELS);

export const BUILT_IN_ROLE_CAPABILITIES: Readonly<
  Record<BuiltInRoleLabel, readonly Capability[]>
> = Object.freeze({
  administrator: freezeCapabilities(
    CAPABILITIES.filter(
      (capability) => capability !== "workspace.delete" && capability !== "workspace.transfer",
    ),
  ),
  observer: freezeCapabilities([
    "workspace.read",
    "policy.read",
    "evidence.read",
    "exception.read",
    "audit.read",
  ]),
  owner: CAPABILITIES,
  policy_author: freezeCapabilities([
    "workspace.read",
    "member.read",
    "role.read",
    "policy.read",
    "policy.write",
    "evidence.read",
    "evidence.submit",
    "exception.read",
    "exception.request",
  ]),
  reviewer: freezeCapabilities([
    "workspace.read",
    "member.read",
    "role.read",
    "policy.read",
    "policy.approve",
    "evidence.read",
    "exception.read",
    "exception.request",
    "exception.decide",
    "audit.read",
  ]),
});

export const DEFAULT_ROLE_PROFILE_LABELS = Object.freeze([
  "administrator",
  "policy_author",
  "reviewer",
  "observer",
] as const satisfies readonly DefaultRoleProfileLabel[]);

export const OWNER_ONLY_CAPABILITIES = Object.freeze([
  "workspace.delete",
  "workspace.transfer",
] as const satisfies readonly Capability[]);

export type OwnerOnlyCapability = (typeof OWNER_ONLY_CAPABILITIES)[number];
export type CustomRoleCapability = Exclude<Capability, OwnerOnlyCapability>;

const ownerOnlyCapabilitySet: ReadonlySet<string> = new Set(OWNER_ONLY_CAPABILITIES);

export const CUSTOM_ROLE_CAPABILITIES = Object.freeze(
  CAPABILITIES.filter(
    (capability): capability is CustomRoleCapability => !ownerOnlyCapabilitySet.has(capability),
  ),
);

export type ValidatedRoleLabel = Readonly<{
  displayLabel: string;
  normalizedLabel: string;
}>;

export type CustomRoleCapabilityDocument = Readonly<{
  capabilities: readonly CustomRoleCapability[];
}>;

export const ROLE_DOCUMENT_QUARANTINE_REASONS = Object.freeze([
  "document_not_object",
  "document_unknown_field",
  "capabilities_not_array",
  "capability_not_string",
  "capability_unknown",
  "capability_owner_only",
  "capability_duplicate",
] as const);

export type RoleDocumentQuarantineReason = (typeof ROLE_DOCUMENT_QUARANTINE_REASONS)[number];

export type ResolvedRoleDocument =
  | Readonly<{
      capabilities: readonly CustomRoleCapability[];
      quarantineReasons: readonly [];
      quarantineState: "valid";
    }>
  | Readonly<{
      capabilities: readonly [];
      quarantineReasons: readonly RoleDocumentQuarantineReason[];
      quarantineState: "quarantined";
    }>;

export type MembershipAuthority =
  | Readonly<{ isOwner: true }>
  | Readonly<{ isOwner: false; role: ResolvedRoleDocument }>;

const EMPTY_CAPABILITIES: readonly [] = Object.freeze([]);
const EMPTY_QUARANTINE_REASONS: readonly [] = Object.freeze([]);

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && capabilitySet.has(value);
}

export function isCustomRoleCapability(value: unknown): value is CustomRoleCapability {
  return isCapability(value) && !ownerOnlyCapabilitySet.has(value);
}

export function isReservedRoleLabel(value: unknown): boolean {
  return typeof value === "string" && reservedRoleLabels.has(value.trim().toLowerCase());
}

export function validateCustomRoleLabel(value: unknown): Result<ValidatedRoleLabel, AppError> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return err(roleValidationError("label", "label_required"));
  }

  const displayLabel = value.trim();
  const normalizedLabel = displayLabel.toLowerCase();
  if (reservedRoleLabels.has(normalizedLabel)) {
    return err(roleValidationError("label", "label_reserved"));
  }

  return ok(Object.freeze({ displayLabel, normalizedLabel }));
}

export function validateCustomRoleCapabilityDocument(
  value: unknown,
): Result<CustomRoleCapabilityDocument, AppError> {
  const issue = inspectCapabilityDocument(value);
  if (!issue.ok) {
    return err(roleValidationError(issue.field, issue.reason));
  }
  return ok(Object.freeze({ capabilities: issue.capabilities }));
}

export function resolveStoredRoleDocument(value: unknown): ResolvedRoleDocument {
  const issue = inspectCapabilityDocument(value);
  if (issue.ok) {
    return Object.freeze({
      capabilities: issue.capabilities,
      quarantineReasons: EMPTY_QUARANTINE_REASONS,
      quarantineState: "valid" as const,
    });
  }

  return Object.freeze({
    capabilities: EMPTY_CAPABILITIES,
    quarantineReasons: Object.freeze([issue.quarantineReason]),
    quarantineState: "quarantined" as const,
  });
}

export function hasCapability(authority: MembershipAuthority, capability: Capability): boolean {
  if (authority.isOwner) return true;
  return authority.role.capabilities.some((granted) => granted === capability);
}

export function effectiveCapabilities(authority: MembershipAuthority): readonly Capability[] {
  return authority.isOwner ? CAPABILITIES : authority.role.capabilities;
}

export function groupCapabilities(capabilities: Iterable<Capability>): CapabilityGroups {
  const included = new Set(capabilities);
  return Object.freeze({
    audit: freezeCapabilities(ALL_CAPABILITIES_BY_GROUP.audit.filter((value) => included.has(value))),
    billing: freezeCapabilities(
      ALL_CAPABILITIES_BY_GROUP.billing.filter((value) => included.has(value)),
    ),
    evidence: freezeCapabilities(
      ALL_CAPABILITIES_BY_GROUP.evidence.filter((value) => included.has(value)),
    ),
    exception: freezeCapabilities(
      ALL_CAPABILITIES_BY_GROUP.exception.filter((value) => included.has(value)),
    ),
    member: freezeCapabilities(
      ALL_CAPABILITIES_BY_GROUP.member.filter((value) => included.has(value)),
    ),
    policy: freezeCapabilities(
      ALL_CAPABILITIES_BY_GROUP.policy.filter((value) => included.has(value)),
    ),
    role: freezeCapabilities(ALL_CAPABILITIES_BY_GROUP.role.filter((value) => included.has(value))),
    workspace: freezeCapabilities(
      ALL_CAPABILITIES_BY_GROUP.workspace.filter((value) => included.has(value)),
    ),
  });
}

export function flattenCapabilityGroups(groups: CapabilityGroups): readonly Capability[] {
  const included = new Set<Capability>();
  for (const group of CAPABILITY_GROUP_NAMES) {
    for (const capability of groups[group]) included.add(capability);
  }
  return freezeCapabilities(CAPABILITIES.filter((capability) => included.has(capability)));
}

type DocumentInspection =
  | Readonly<{ capabilities: readonly CustomRoleCapability[]; ok: true }>
  | Readonly<{
      field: string;
      ok: false;
      quarantineReason: RoleDocumentQuarantineReason;
      reason: string;
    }>;

function inspectCapabilityDocument(value: unknown): DocumentInspection {
  if (!isPlainRecord(value)) {
    return invalidDocument("capabilityDocument", "document_not_object", "document_not_object");
  }

  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "capabilities") {
    return invalidDocument(
      "capabilityDocument",
      "document_unknown_field",
      "document_unknown_field",
    );
  }

  const capabilities = value.capabilities;
  if (!Array.isArray(capabilities)) {
    return invalidDocument("capabilities", "capabilities_not_array", "capabilities_not_array");
  }

  const accepted: CustomRoleCapability[] = [];
  const seen = new Set<CustomRoleCapability>();
  for (const [index, capability] of capabilities.entries()) {
    if (typeof capability !== "string") {
      return invalidDocument(
        `capabilities.${String(index)}`,
        "capability_not_string",
        "capability_not_string",
      );
    }
    if (!isCapability(capability)) {
      return invalidDocument(
        `capabilities.${String(index)}`,
        "capability_unknown",
        "capability_unknown",
      );
    }
    if (!isCustomRoleCapability(capability)) {
      return invalidDocument(
        `capabilities.${String(index)}`,
        "capability_owner_only",
        "capability_owner_only",
      );
    }
    if (seen.has(capability)) {
      return invalidDocument(
        `capabilities.${String(index)}`,
        "capability_duplicate",
        "capability_duplicate",
      );
    }
    seen.add(capability);
    accepted.push(capability);
  }

  return Object.freeze({ capabilities: Object.freeze([...accepted]), ok: true });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidDocument(
  field: string,
  quarantineReason: RoleDocumentQuarantineReason,
  reason: string,
): DocumentInspection {
  return Object.freeze({ field, ok: false, quarantineReason, reason });
}

function roleValidationError(field: string, reason: string): AppError {
  return appError("VALIDATION_FAILED", { details: { field, reason } });
}
