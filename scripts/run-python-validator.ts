#!/usr/bin/env node

import { runPythonValidation } from "@kernel-zero/profile-python/runner";

const [policy, root, workspace, out, ...extra] = process.argv.slice(2);
if (policy === undefined || root === undefined || workspace === undefined || out === undefined || extra.length > 0) {
  process.stderr.write("usage: kernel-zero-python <policy.json> <root> <workspaceId> <out.json>\n");
  process.exit(2);
}

try {
  process.exit(runPythonValidation({ out, policy, root, workspace }));
} catch (error) {
  const message = error instanceof Error ? error.message : "failed";
  process.stderr.write(`python-validator: ${message.replace(/\s+/gu, " ").trim().slice(0, 500)}\n`);
  process.exit(2);
}
