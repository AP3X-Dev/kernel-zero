# Autonomous Run State — KERNEL ZERO validator rule language

## Status
- **PRP:** docs/prp/2026-09-09-validator-rule-language.md
- **Session:** autonomous-validator-rule-language-2026-09-09
- **Branch:** feat/validator-rule-language (off main at 618b4cc)
- **MemBerry:** reachable, no entries for this project yet; decisions stored under tag `project:kernel-zero`; the project-level bootstrap (`memberry-setup`, which edits CLAUDE.md) was skipped to keep the run inside PRP scope
- **Current phase:** 3-implement
- **In-flight:** owner checkpoint before step 4 (route dependency-injection seam removal); AUTONOMOUS MODE PAUSED
- **Next action:** on owner confirmation, dispatch step 4 (require-ingress-parse, tasks 4.1-4.6); on refusal, skip to step 5 with FR-ING undelivered and record the block

## Phase Gates
| Phase | Gate | Result | Evidence (command + exit / artifact path) |
|-------|------|--------|-------------------------------------------|
| 1-design | spec exists + verifier PASS | PASS | docs/plans/2026-09-09-validator-rule-language-spec.md revision 4; verifier PASS after three rejections (see advisor log verdicts 1-4) |
| 2-plan | plan exists, every task names files + runnable check, verifier PASS | PASS | docs/plans/2026-09-09-validator-rule-language-plan.md revision 2; verifier PASS after one rejection; baseline measured: verify exit 0, 264/45 unit, 7/3 integration, self-policy 91 files digest sha256:435c3f70…9ed3bb8 |
| 3-implement | `npm run verify` exit 0 with counts; bite proofs; benchmark | in progress | step 1 layers: verify exit 0, unit 287/46, integration 7/3, self-policy pass 92 files, digest sha256:3cf09d734a23a4470eb4bf3a238ec4a9782146df73c9cc3cb10be690a1bcc824 identical twice, golden diff empty, kernel diff empty, bite proof exit 1 on a transport probe, kz-checker PASS, ADR docs/adr/2026-09-09-policy-layers.md. Step 2 require-call-argument: verify exit 0, unit 324/48, integration 7/3, self-policy pass 94 files, digest sha256:4cb0114b6adc3abe40f17b19fbcc87f455edd60ca41d984a373fdd49675e2177 identical twice, benchmark 7674/5481 ms peak 513 MB (checker run), golden and kernel diffs empty, two bites (missing key, opaque spread) exit 1, kz-checker PASS, ADR docs/adr/2026-09-09-require-call-argument.md. Step 3 restrict-state-transition: verify exit 0, unit 352/49, integration 7/3, self-policy pass 95 files, digest sha256:08c2bfa7735fcb4df6162a3feb74028b077e149a5f994f458b9afefaf3a0a0e1 identical twice, benchmark 6883/4768 ms at parity with step 2 (other samples up to 27 s under 97 percent external load, F3 filed), golden and kernel diffs empty, two bites exit 1, kz-checker PASS, ADR docs/adr/2026-09-09-restrict-state-transition.md |
| 4-branch | PR URL recorded | pending | |
| 5-optimize | optimization loop termination | pending | |

## Failed Attempts
| # | Phase/Task | What was tried | Why it failed | Do-not-retry note |
|---|-----------|----------------|---------------|-------------------|

## Decisions
Full log: docs/plans/2026-09-09-validator-rule-language-advisor-log.md

## Follow-ups filed (not absorbed, law 6)
| # | Found in | Item |
|---|---|---|
| F1 | step 2 check | `manifestDigest` hashes raw working-tree bytes; 26 in-scope files are CRLF in this checkout (`core.autocrlf=true`), so the self-policy integrity digest is deterministic here but differs on a fresh LF clone. Pre-existing. Options: normalize EOL in the manifest digest input (contract change, needs kz-grill) or `git add --renormalize` once. Owner decision. |
| F3 | step 3 check | Benchmark headroom: on this machine under unrelated 97 percent load a first run reached 27 s against the 30 s limit; the evaluator is at parity with step 2 on an idle sample. Environment risk for CI runners under contention; a quiet-machine sample belongs in the PR body. |
| F2 | step 2 check | A bare-identifier alias to a matching callee (`const q = tx.policyRevision.findFirst; q({...})`) resolves to chain `q` and passes `require-call-argument` silently; inherited from `resolveCalleeName`, shared with `restrict-call-site`, pinned by a test. Follow-up: alias-following for bare identifiers, or at least `UNRESOLVED` when the const initializer is a matching chain. Changing it moves golden fixtures, so it is its own ADR. |
