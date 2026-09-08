import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../prisma/migrations/20260831050000_initial/migration.sql", import.meta.url),
  "utf8",
);

describe("PostgreSQL migration authority", () => {
  it("declares every governance entity and nothing from the retired SaaS shell", () => {
    for (const table of ["PolicyPack", "PolicyRevision", "ExceptionRequest", "SigningKey", "EvidenceRun", "Finding", "AuditRecord"]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    for (const retired of ["User", "Session", "Workspace", "Membership", "Invitation", "QuotaCounter", "SubscriptionProjection", "PaymentEventReceipt", "PolicyAuthorityKey", "PolicyApprovalArtifact"]) {
      expect(migration).not.toContain(`CREATE TABLE "${retired}"`);
    }
  });

  it("contains named concurrency, tenant, cardinality, and immutability authorities", () => {
    for (const authority of [
      "policy_revision_one_active_per_pack_key",
      "policy_revision_approval_shape_check",
      "exception_decision_shape_check",
      "exception_expiry_bound_check",
      "exception_revocation_shape_check",
      "policy_revision_workspace_pack_fkey",
      "finding_workspace_run_fkey",
      "evidence_run_policy_digest_fkey",
      "audit_actor_shape_check",
      "kernel_zero_jsonb_key_count(\"metadata\") <= 32",
      "audit_record_immutable_update",
      "policy_revision_immutable_content",
      "evidence_run_immutable_update",
    ]) {
      expect(migration).toContain(authority);
    }
  });

  it("keeps audit workspace identity opaque and outside any foreign key", () => {
    expect(migration).toContain('"workspaceOpaqueId" UUID NOT NULL');
    expect(migration).not.toMatch(/AuditRecord[^;]+FOREIGN KEY/su);
  });
});
