-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PolicyPackState" AS ENUM ('draft', 'active', 'retired');

-- CreateEnum
CREATE TYPE "PolicyRevisionState" AS ENUM ('draft', 'approved', 'active', 'superseded');

-- CreateEnum
CREATE TYPE "ExceptionDecisionState" AS ENUM ('pending', 'approved', 'denied');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('pass', 'fail', 'error');

-- CreateEnum
CREATE TYPE "FindingLevel" AS ENUM ('error', 'warning');

-- CreateEnum
CREATE TYPE "AttestationState" AS ENUM ('recorded', 'attested');

-- CreateEnum
CREATE TYPE "AuditActorKind" AS ENUM ('operator', 'system');

-- CreateTable
CREATE TABLE "PolicyPack" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "lifecycleState" "PolicyPackState" NOT NULL DEFAULT 'draft',
    "activeRevisionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PolicyPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRevision" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "packId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "canonicalJson" TEXT NOT NULL,
    "digest" CHAR(71),
    "state" "PolicyRevisionState" NOT NULL DEFAULT 'draft',
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionRequest" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "policyDigest" CHAR(71) NOT NULL,
    "ruleId" VARCHAR(80) NOT NULL,
    "findingFingerprint" CHAR(71) NOT NULL,
    "rationale" VARCHAR(2000) NOT NULL,
    "issueUrl" VARCHAR(2048),
    "decisionState" "ExceptionDecisionState" NOT NULL DEFAULT 'pending',
    "decisionNote" VARCHAR(2000),
    "validUntil" TIMESTAMPTZ(3) NOT NULL,
    "decidedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revocationReason" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ExceptionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningKey" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "keyId" VARCHAR(120) NOT NULL,
    "publicKey" TEXT NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SigningKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRun" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "policyDigest" CHAR(71) NOT NULL,
    "repositoryLabel" VARCHAR(200) NOT NULL,
    "revisionLabel" VARCHAR(200) NOT NULL,
    "toolVersion" VARCHAR(100) NOT NULL,
    "generatedAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "EvidenceStatus" NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL,
    "exceptedCount" INTEGER NOT NULL,
    "filesScanned" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "manifestDigest" CHAR(71) NOT NULL,
    "integrityDigest" CHAR(71) NOT NULL,
    "signatureKeyId" VARCHAR(120),
    "signatureValue" TEXT,
    "exceptionBundleDigest" CHAR(71),
    "attestationState" "AttestationState" NOT NULL DEFAULT 'recorded',
    "correlationId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "evidenceRunId" UUID NOT NULL,
    "findingId" CHAR(71) NOT NULL,
    "fingerprint" CHAR(71) NOT NULL,
    "ruleId" VARCHAR(80) NOT NULL,
    "level" "FindingLevel" NOT NULL,
    "messageCode" VARCHAR(80) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "path" VARCHAR(1000) NOT NULL,
    "startLine" INTEGER NOT NULL,
    "startColumn" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "endColumn" INTEGER NOT NULL,
    "exceptionRequestId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRecord" (
    "id" UUID NOT NULL,
    "workspaceOpaqueId" UUID NOT NULL,
    "actorKind" "AuditActorKind" NOT NULL,
    "systemActorRef" VARCHAR(120),
    "actionCode" VARCHAR(120) NOT NULL,
    "subjectType" VARCHAR(120) NOT NULL,
    "subjectId" VARCHAR(255) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "metadata" JSONB NOT NULL,
    "correlationId" UUID NOT NULL,
    "clientAddressHint" VARCHAR(128),
    "userAgentHint" VARCHAR(1024),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyPack_activeRevisionId_key" ON "PolicyPack"("activeRevisionId");

-- CreateIndex
CREATE INDEX "policy_pack_workspace_state_idx" ON "PolicyPack"("workspaceId", "lifecycleState", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "policy_pack_workspace_slug_key" ON "PolicyPack"("workspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "policy_pack_workspace_id_key" ON "PolicyPack"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "policy_revision_workspace_state_idx" ON "PolicyRevision"("workspaceId", "state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "policy_revision_pack_revision_key" ON "PolicyRevision"("packId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "policy_revision_workspace_digest_key" ON "PolicyRevision"("workspaceId", "digest");

-- CreateIndex
CREATE UNIQUE INDEX "policy_revision_pack_id_key" ON "PolicyRevision"("packId", "id");

-- CreateIndex
CREATE INDEX "exception_workspace_state_expiry_idx" ON "ExceptionRequest"("workspaceId", "decisionState", "validUntil");

-- CreateIndex
CREATE INDEX "exception_match_idx" ON "ExceptionRequest"("workspaceId", "policyDigest", "ruleId", "findingFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "exception_workspace_id_key" ON "ExceptionRequest"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "signing_key_workspace_active_idx" ON "SigningKey"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "signing_key_workspace_key_key" ON "SigningKey"("workspaceId", "keyId");

-- CreateIndex
CREATE INDEX "evidence_run_workspace_generated_idx" ON "EvidenceRun"("workspaceId", "generatedAt");

-- CreateIndex
CREATE INDEX "evidence_run_policy_status_idx" ON "EvidenceRun"("workspaceId", "policyDigest", "status");

-- CreateIndex
CREATE INDEX "evidence_run_repo_generated_idx" ON "EvidenceRun"("workspaceId", "repositoryLabel", "generatedAt", "id");

-- CreateIndex
CREATE INDEX "evidence_run_result_attestation_idx" ON "EvidenceRun"("workspaceId", "status", "attestationState", "generatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_run_workspace_run_key" ON "EvidenceRun"("workspaceId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_run_workspace_id_key" ON "EvidenceRun"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "finding_workspace_rule_level_idx" ON "Finding"("workspaceId", "ruleId", "level");

-- CreateIndex
CREATE INDEX "finding_run_path_idx" ON "Finding"("evidenceRunId", "path");

-- CreateIndex
CREATE INDEX "finding_workspace_run_rule_level_idx" ON "Finding"("workspaceId", "evidenceRunId", "ruleId", "level", "createdAt", "id");

-- CreateIndex
CREATE INDEX "finding_workspace_path_idx" ON "Finding"("workspaceId", "path", "createdAt", "id");

-- CreateIndex
CREATE INDEX "finding_workspace_exception_idx" ON "Finding"("workspaceId", "exceptionRequestId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "finding_run_finding_key" ON "Finding"("evidenceRunId", "findingId");

-- CreateIndex
CREATE INDEX "audit_workspace_created_idx" ON "AuditRecord"("workspaceOpaqueId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_action_created_idx" ON "AuditRecord"("actionCode", "createdAt");

-- CreateIndex
CREATE INDEX "audit_subject_created_idx" ON "AuditRecord"("subjectType", "subjectId", "createdAt");

-- AddForeignKey
ALTER TABLE "PolicyPack" ADD CONSTRAINT "PolicyPack_activeRevisionId_fkey" FOREIGN KEY ("activeRevisionId") REFERENCES "PolicyRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_packId_fkey" FOREIGN KEY ("packId") REFERENCES "PolicyPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_evidenceRunId_fkey" FOREIGN KEY ("evidenceRunId") REFERENCES "EvidenceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_exceptionRequestId_fkey" FOREIGN KEY ("exceptionRequestId") REFERENCES "ExceptionRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant-aware composite foreign keys are the database authority. Prisma emits
-- scalar relations, so replace the affected constraints with workspace-aware
-- variants.
ALTER TABLE "PolicyRevision" DROP CONSTRAINT "PolicyRevision_packId_fkey";
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "policy_revision_workspace_pack_fkey"
  FOREIGN KEY ("workspaceId", "packId")
  REFERENCES "PolicyPack"("workspaceId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyPack" DROP CONSTRAINT "PolicyPack_activeRevisionId_fkey";
ALTER TABLE "PolicyPack" ADD CONSTRAINT "policy_pack_active_revision_fkey"
  FOREIGN KEY ("id", "activeRevisionId")
  REFERENCES "PolicyRevision"("packId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "Finding" DROP CONSTRAINT "Finding_evidenceRunId_fkey";
ALTER TABLE "Finding" ADD CONSTRAINT "finding_workspace_run_fkey"
  FOREIGN KEY ("workspaceId", "evidenceRunId")
  REFERENCES "EvidenceRun"("workspaceId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Finding" DROP CONSTRAINT "Finding_exceptionRequestId_fkey";
ALTER TABLE "Finding" ADD CONSTRAINT "finding_workspace_exception_fkey"
  FOREIGN KEY ("workspaceId", "exceptionRequestId")
  REFERENCES "ExceptionRequest"("workspaceId", "id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EvidenceRun" ADD CONSTRAINT "evidence_run_policy_digest_fkey"
  FOREIGN KEY ("workspaceId", "policyDigest")
  REFERENCES "PolicyRevision"("workspaceId", "digest")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Closed cardinality and active-row authorities.
CREATE UNIQUE INDEX "policy_revision_one_active_per_pack_key"
  ON "PolicyRevision"("packId") WHERE "state" = 'active';

-- Bounded values and state invariants used by concurrent services.
ALTER TABLE "EvidenceRun" ADD CONSTRAINT "evidence_run_nonnegative_counts_check"
  CHECK ("errorCount" >= 0 AND "warningCount" >= 0 AND "exceptedCount" >= 0 AND "filesScanned" >= 0 AND "durationMs" >= 0);
ALTER TABLE "Finding" ADD CONSTRAINT "finding_location_check"
  CHECK (
    "startLine" > 0 AND "startColumn" > 0 AND "endLine" > 0 AND "endColumn" > 0
    AND ("endLine" > "startLine" OR ("endLine" = "startLine" AND "endColumn" >= "startColumn"))
  );
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "policy_revision_approval_shape_check"
  CHECK (
    ("state" = 'draft' AND "digest" IS NULL AND "approvedAt" IS NULL)
    OR ("state" <> 'draft' AND "digest" IS NOT NULL AND "approvedAt" IS NOT NULL)
  );
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "exception_decision_shape_check"
  CHECK (
    ("decisionState" = 'pending' AND "decisionNote" IS NULL AND "decidedAt" IS NULL)
    OR ("decisionState" <> 'pending' AND char_length(btrim("decisionNote")) > 0 AND "decidedAt" IS NOT NULL)
  );
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "exception_expiry_bound_check"
  CHECK ("validUntil" > "createdAt" AND "validUntil" <= "createdAt" + interval '90 days');
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "exception_revocation_shape_check"
  CHECK (
    ("revokedAt" IS NULL AND "revocationReason" IS NULL)
    OR ("revokedAt" IS NOT NULL AND char_length(btrim("revocationReason")) > 0)
  );
CREATE FUNCTION kernel_zero_jsonb_key_count(value jsonb) RETURNS integer
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT count(*)::integer FROM jsonb_object_keys(value) $$;
ALTER TABLE "AuditRecord" ADD CONSTRAINT "audit_actor_shape_check"
  CHECK (
    ("actorKind" = 'operator' AND "systemActorRef" IS NULL)
    OR ("actorKind" = 'system' AND char_length(btrim("systemActorRef")) BETWEEN 1 AND 120)
  );
ALTER TABLE "AuditRecord" ADD CONSTRAINT "audit_metadata_bounds_check"
  CHECK (
    jsonb_typeof("metadata") = 'object'
    AND kernel_zero_jsonb_key_count("metadata") <= 32
    AND pg_column_size("metadata") <= 16384
  );

ALTER TABLE "PolicyRevision" ADD CONSTRAINT "policy_revision_digest_check"
  CHECK ("digest" IS NULL OR "digest" ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "exception_digest_check"
  CHECK ("policyDigest" ~ '^sha256:[0-9a-f]{64}$' AND "findingFingerprint" ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE "EvidenceRun" ADD CONSTRAINT "evidence_digest_check"
  CHECK (
    "policyDigest" ~ '^sha256:[0-9a-f]{64}$'
    AND "manifestDigest" ~ '^sha256:[0-9a-f]{64}$'
    AND "integrityDigest" ~ '^sha256:[0-9a-f]{64}$'
    AND ("exceptionBundleDigest" IS NULL OR "exceptionBundleDigest" ~ '^sha256:[0-9a-f]{64}$')
  );
ALTER TABLE "Finding" ADD CONSTRAINT "finding_digest_check"
  CHECK ("findingId" ~ '^sha256:[0-9a-f]{64}$' AND "fingerprint" ~ '^sha256:[0-9a-f]{64}$');

-- Approved policy bytes, audit receipts, and evidence rows are immutable. Policy
-- state may advance, but canonical bytes and approval provenance cannot change.
CREATE FUNCTION kernel_zero_reject_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit records are immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "audit_record_immutable_update"
  BEFORE UPDATE OR DELETE ON "AuditRecord"
  FOR EACH ROW EXECUTE FUNCTION kernel_zero_reject_audit_change();

CREATE FUNCTION kernel_zero_guard_policy_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."state" <> 'draft' AND (
    NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
    OR NEW."packId" IS DISTINCT FROM OLD."packId"
    OR NEW."revision" IS DISTINCT FROM OLD."revision"
    OR NEW."canonicalJson" IS DISTINCT FROM OLD."canonicalJson"
    OR NEW."digest" IS DISTINCT FROM OLD."digest"
    OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
  ) THEN
    RAISE EXCEPTION 'approved policy revision content is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "policy_revision_immutable_content"
  BEFORE UPDATE ON "PolicyRevision"
  FOR EACH ROW EXECUTE FUNCTION kernel_zero_guard_policy_revision();

CREATE FUNCTION kernel_zero_reject_evidence_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'evidence rows cannot be edited' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "evidence_run_immutable_update"
  BEFORE UPDATE ON "EvidenceRun"
  FOR EACH ROW EXECUTE FUNCTION kernel_zero_reject_evidence_update();
CREATE TRIGGER "finding_immutable_update"
  BEFORE UPDATE ON "Finding"
  FOR EACH ROW EXECUTE FUNCTION kernel_zero_reject_evidence_update();
