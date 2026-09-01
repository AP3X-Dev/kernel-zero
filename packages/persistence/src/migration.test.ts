import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../prisma/migrations/20260831050000_initial/migration.sql", import.meta.url),
  "utf8",
);

describe("PostgreSQL migration authority", () => {
  it("declares every required tenant and operational entity", () => {
    for (const table of [
      "Workspace",
      "Membership",
      "RoleProfile",
      "Invitation",
      "PolicyPack",
      "PolicyRevision",
      "ExceptionRequest",
      "SigningKey",
      "EvidenceRun",
      "Finding",
      "QuotaCounter",
      "SubscriptionProjection",
      "PaymentEventReceipt",
      "TrialFingerprint",
      "AuditRecord",
      "SystemOperatorGrant",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it("contains named concurrency, tenant, cardinality, and immutability authorities", () => {
    for (const authority of [
      "membership_one_owner_per_workspace_key",
      "invitation_one_active_email_key",
      "policy_revision_one_active_per_pack_key",
      "policy_revision_maker_checker_check",
      "policy_revision_approval_shape_check",
      "exception_maker_checker_check",
      "exception_decision_shape_check",
      "exception_expiry_bound_check",
      "exception_revocation_shape_check",
      "workspace_owner_membership_fkey",
      "membership_workspace_role_fkey",
      "policy_revision_workspace_pack_fkey",
      "finding_workspace_run_fkey",
      "quota_counter_nonnegative_check",
      "audit_actor_shape_check",
      "kernel_zero_jsonb_key_count(\"metadata\") <= 32",
      "audit_record_immutable_update",
      "policy_revision_immutable_content",
      "evidence_run_immutable_update",
    ]) {
      expect(migration).toContain(authority);
    }
  });

  it("keeps audit workspace identity opaque and outside workspace cascade foreign keys", () => {
    expect(migration).toContain('"workspaceOpaqueId" UUID NOT NULL');
    expect(migration).not.toMatch(/AuditRecord[^;]+FOREIGN KEY \("workspaceOpaqueId"\)/su);
  });
});
