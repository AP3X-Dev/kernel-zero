declare const db: { policyRevision: { updateMany(a: unknown): void } };
declare const id: string;
declare const patch: object;
declare const key: string;

db.policyRevision.updateMany({ data: { state: "approved" }, where: { id, state: "draft" } });
db.policyRevision.updateMany({ data: { state: "active" }, where: { id, state: "approved" } });
db.policyRevision.updateMany({ data: { state: "active" }, where: { id, state: "draft" } });
db.policyRevision.updateMany({ data: { state: "approved" }, where: { id } });
db.policyRevision.updateMany({ data: { ...patch }, where: { id, state: "draft" } });
db.policyRevision.updateMany({ data: { canonicalJson: "{}" }, where: { id } });
db[key].updateMany({ data: { state: "approved" }, where: { id, state: "draft" } });
