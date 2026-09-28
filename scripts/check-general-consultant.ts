import { pathToFileURL } from "node:url";
import { inspectConsultantProfile } from "../src/main/general-tasks/consultant-config";

/** No dotenv, credential store, persistence, provider transport or app launch. */
export function generalConsultantPreflight(env: NodeJS.ProcessEnv) {
  const inspection = inspectConsultantProfile(env);
  return { exitCode: inspection.status === "ready" ? 0 : 2, inspection };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    process.stderr.write("This check takes no arguments. Configure only the explicit session environment; do not pass credentials on the command line.\n");
    process.exitCode = 2;
  } else {
    const result = generalConsultantPreflight(process.env);
    process.stdout.write(`${JSON.stringify(result.inspection, null, 2)}\n`);
    process.exitCode = result.exitCode;
  }
}
