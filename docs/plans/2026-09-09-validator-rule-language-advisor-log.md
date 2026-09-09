# Advisor and verifier log — validator rule language

Session `autonomous-validator-rule-language-2026-09-09`. Every decision and every verdict, in order.

### Decision 1: PRP acceptance (human)
**Skill:** autonomous-advisor
**Question:** Does `docs/prp/2026-09-09-validator-rule-language.md` stand as the source of truth?
**Owner decided:** Approved, start the run.
**Reasoning:** Owner review of the draft on 2026-09-09; no edits requested.

### Decision 2: MemBerry bootstrap (orchestrator)
**Skill:** autonomous-advisor activation
**Question:** Invoke `memberry-setup` to write a project config into CLAUDE.md?
**Decided:** Skip; store run decisions under `project:kernel-zero` without a project bootstrap.
**Reasoning:** MemBerry is reachable and the store works without the config; editing CLAUDE.md is outside PRP section 3 scope and the skill treats MemBerry as optional.

### Verdict 1: DESIGN_APPROVAL on the design spec (revision 1)
**Verifier:** autonomous-verifier on a different model
**Verdict:** REJECT, ten required fixes.
**Substance:** two self-policy rules would fail on the current tree (opaque-spread rule versus `evidence.ts` `where` literals; the proposed route edit was not provable); new fixtures under `fixtures/checks/**` would move the golden digest; layer references leaked into `scope`; `findUnique` contradiction; only one verb rule; unsafe-receiver detection unreachable after `unwrapExpression`; FR-DOG rows missing; TM-V03 discharge unstated; closure escape grammar unfixed.

### Decision 3: spec revision 2 (orchestrator, advisor role)
**Question:** how to satisfy the ten fixes.
**Decided:** harmless-spread semantics (spreads after the key are provable only when their operands are literal-keyed object literals or conditionals of them, none naming the key) instead of editing `evidence.ts`; `export const POST = factory()` is a proof failure, and the route becomes an exported `POST` function with a no-argument dependency accessor and `vi.mock`-based tests; five verb rules; fixtures move to `fixtures/kinds/`; `findUnique` dropped; rule-only glob aliases so `scope` stays glob-only; unsafe receiver judged on the raw receiver before unwrapping, optional receivers unprovable; FR-DOG rows added; TM-V03 discharge stated; `escape:closure` literal.
**Reasoning:** PRP principle 3 (identity stable), FR-ING-006 as written, SC-V05, SC-V06 (forced edits must be named), and the fail-closed principle in PRP section 2.

### Verdict 2: DESIGN_APPROVAL on the design spec (revision 2)
**Verdict:** REJECT, five required fixes: ingress reader chain mismatch (`dependencies.resolveSubmission` not in any list); `db["policy"]` fixture expectation false (string-literal element access resolves); the layer-reference union could not produce its own message; `profiles` layer dropped without amending FR-LAY-005; harmless-spread recursion ambiguity.

### Decision 4: spec revision 3 (orchestrator, advisor role)
**Decided:** `readerCalls` names `dependencies.resolveSubmission`; route shape written out with its untrusted set and the `vi.mock` test plan; `db[key]` fixture added with the unresolved outcome and `db["policy"]` corrected to `CALL_ARGUMENT_MISSING`; the reference union is dropped and one policy `superRefine` emits three distinct messages (not a slug, not allowed in scope, not declared); harmless-spread judged on each branch literal's own top-level members only (getters, setters, methods count as members); PRP FR-LAY-005 amended to six layers with the reason recorded in the PRP text.
**Reasoning:** each fix is a correctness defect the verifier cited with file:line evidence; the FR-LAY-005 amendment removes an unexercised layer under PRP section 2 item 4 and adds no scope.

### Verdict 3: DESIGN_APPROVAL on the design spec (revision 3)
**Verdict:** REJECT, four fixes: FR-ING-006 reader/allowed values diverged from the PRP without amendment; FR-ING-005 "reassignment is a proof failure" contradicted the route trace; "carries untrusted" did not cover reader-call results; removing the route's dependency-injection seam needs an owner checkpoint before the edit. Fixes 1 to 5 of revision 2 confirmed resolved; FR-LAY, FR-ARG, FR-STA judged clean.

### Decision 5: spec revision 4 (orchestrator, advisor role)
**Decided:** PRP FR-ING-005 and FR-ING-006 amended in the PRP text with reasons; reader-call results carry untrusted by definition; local reassignment widens `U` monotonically; an owner checkpoint is inserted before the route edit in PRP section 12, spec section 9, and plan task 4.4, with the run stopping after step 3 if confirmation is absent.
**Reasoning:** the amendments remove a contradiction between the rule and the only route it governs; the checkpoint is the CLAUDE.md refactoring rule and the skill's "delete existing functionality" guardrail.

### Verdict 4: DESIGN_APPROVAL on the design spec (revision 4)
**Verdict:** PASS. Risks accepted: four vacuous verb rules on this tree; FR-ING-002 wording (cleaned up afterwards, no behaviour change); escape detection enumerated rather than closed (plan task 4.2 now adds the defensive default); `allowedCalls` results trusted unconditionally (to be recorded in the FR-ING ADR).

### Verdict 5: DESIGN_APPROVAL on the implementation plan (revision 1)
**Verdict:** REJECT, three fixes: the baseline digest was quoted from an earlier run, not measured on the branch; task 5.2 edited `CLAUDE.md` and the skill outside the spec with a grep as acceptance; the two spec-mandated ADR notes for `require-call-argument` had no task.

### Decision 6: plan revision 2 (orchestrator)
**Decided:** re-measure the baseline with a fresh `npm run verify` on the branch and paste the values; drop the `CLAUDE.md` edit and add the skill doc to spec §8 and FR-DOG-003 as a deliverable with the step gate as acceptance; make the ADR notes named deliverables of task 2.5.
**Reasoning:** law 2 (prove, don't claim); PRP section 3.2 (no files outside the spec unless forced or listed); the skill listing kinds is documentation of the shipped schema, which FR-DOG-003 already covers in spirit.

### Verdict 6: DESIGN_APPROVAL on the implementation plan (revision 2)
**Verdict:** PASS. Verifier independently re-ran unit, integration, and architecture checks and matched the digests on disk.

### Verdict 7: kz-checker on step 1 (named layers)
**Verdict:** PASS; all five implementer deviations judged acceptable (exactOptional for the digest type, layer values reject nested references, message carries rule id and field, shared ruleFileLists export, expander throws on an unseen reference).
