declare const db: { policyRevision: { updateMany(a: unknown): void } };

db.policyRevision.updateMany({ data: { state: "approved" }, where: { state: "draft" } });
