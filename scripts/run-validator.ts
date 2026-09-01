import { runCli } from "../packages/validator/src/cli";
import { runValidation } from "../packages/validator/src/runner";

const forwarded = process.argv.slice(2);
process.exitCode = await runCli(forwarded[0] === "--" ? forwarded.slice(1) : forwarded, runValidation);
