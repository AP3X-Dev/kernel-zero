---
name: kz-adopt
description: Install KERNEL ZERO enforcement into a consumer repository: policy file, validator, pre-commit hook, and the CI required check, with the custody warnings. Use when asked to "adopt kernel zero in <repo>", "add the validator to our repo", or "set up the merge gate".
---

# kz-adopt

Announce: "Using kz-adopt on <target repo>."

Read `docs/validator-and-hooks.md` first; it is the source of every command below.

1. Policy: copy `docs/contracts/examples/repository-policy-v1.json` as `kernel-zero.policy.json` in the target root. Adjust `scope.include` and `scope.exclude` to the target's layout. Keep every rule at `level: "error"` unless the owner says otherwise in writing.
2. Validator: add `@kernel-zero/validator` as a dev dependency from the location the owner specifies (no registry publication exists; do not invent one). Its `bin` name is `kernel-zero`. Add the script:
   `"validator:self": "kernel-zero validate --policy kernel-zero.policy.json --root . --workspace <workspace-uuid> --out .kernel-zero/evidence.json"`
   `--workspace` must be a lowercase UUIDv7.
3. Prove it runs: `npm run validator:self`, expect exit 0, 1, or 2 and an `evidence.json`. Exit 2 means the run could not complete; fix that before continuing.
4. Local hook: copy `.githooks/pre-commit`, tell the owner to run `git config core.hooksPath .githooks`. State plainly that local hooks are feedback, not a security boundary.
5. CI: copy `.github/workflows/kernel-zero.yml`; tell the owner that a repository administrator must make the `verify` job a required branch check and must protect the workflow, policy, and validator from the contributors being judged.
6. Do not push, open a PR, or change branch protection yourself. Hand the owner the exact list of settings to change.

Report: the three exit codes observed, the evidence path, and the two custody items still owned by a human.
