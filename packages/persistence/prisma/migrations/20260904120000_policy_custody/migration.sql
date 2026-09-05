-- Policy custody: workspace policy-authority public keys and immutable signed approval artifacts.
-- Only public key material (the Ed25519 JWK "x" coordinate) and the authority timeline are stored.

-- CreateTable
CREATE TABLE "PolicyAuthorityKey" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "keyId" VARCHAR(120) NOT NULL,
    "publicKeyX" CHAR(43) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validUntil" TIMESTAMPTZ(3),
    "revokedFrom" TIMESTAMPTZ(3),
    "creatorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAuthorityKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyApprovalArtifact" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "authorityKeyId" UUID NOT NULL,
    "policyDigest" CHAR(71) NOT NULL,
    "digest" CHAR(71) NOT NULL,
    "approvedAt" TIMESTAMPTZ(3) NOT NULL,
    "canonicalJson" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyApprovalArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "policy_authority_key_workspace_key_key" ON "PolicyAuthorityKey"("workspaceId", "keyId");

-- CreateIndex
CREATE UNIQUE INDEX "policy_authority_key_workspace_id_key" ON "PolicyAuthorityKey"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "policy_authority_key_workspace_valid_idx" ON "PolicyAuthorityKey"("workspaceId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "policy_approval_artifact_workspace_revision_key" ON "PolicyApprovalArtifact"("workspaceId", "revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "policy_approval_artifact_workspace_id_key" ON "PolicyApprovalArtifact"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "policy_approval_artifact_workspace_approved_idx" ON "PolicyApprovalArtifact"("workspaceId", "approvedAt");

-- AddForeignKey
ALTER TABLE "PolicyAuthorityKey" ADD CONSTRAINT "PolicyAuthorityKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAuthorityKey" ADD CONSTRAINT "PolicyAuthorityKey_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyApprovalArtifact" ADD CONSTRAINT "PolicyApprovalArtifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyApprovalArtifact" ADD CONSTRAINT "PolicyApprovalArtifact_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PolicyRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyApprovalArtifact" ADD CONSTRAINT "policy_approval_artifact_workspace_key_fkey" FOREIGN KEY ("workspaceId", "authorityKeyId") REFERENCES "PolicyAuthorityKey"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Authority timeline and key-material shape checks
ALTER TABLE "PolicyAuthorityKey" ADD CONSTRAINT "policy_authority_key_validity_check"
  CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom");
ALTER TABLE "PolicyAuthorityKey" ADD CONSTRAINT "policy_authority_key_revocation_check"
  CHECK ("revokedFrom" IS NULL OR "revokedFrom" >= "validFrom");
ALTER TABLE "PolicyAuthorityKey" ADD CONSTRAINT "policy_authority_key_public_x_check"
  CHECK ("publicKeyX" ~ '^[A-Za-z0-9_-]{43}$');
ALTER TABLE "PolicyApprovalArtifact" ADD CONSTRAINT "policy_approval_artifact_digest_shape_check"
  CHECK ("policyDigest" ~ '^sha256:[0-9a-f]{64}$' AND "digest" ~ '^sha256:[0-9a-f]{64}$');

-- A signed approval artifact never changes after it is written.
CREATE FUNCTION kernel_zero_reject_policy_approval_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'policy approval artifacts cannot be edited' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "policy_approval_artifact_immutable_update"
  BEFORE UPDATE ON "PolicyApprovalArtifact"
  FOR EACH ROW EXECUTE FUNCTION kernel_zero_reject_policy_approval_update();
