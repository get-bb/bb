import { spawnSync } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
const output = join(process.env.RUNNER_TEMP, "exit-probe");
mkdirSync(output, { recursive: true });
for (const stage of ["focused", "package"]) {
  for (let iteration = 1; iteration <= (stage === "focused" ? 20 : 5); iteration++) {
    const fd = openSync(join(output, `${stage}-${iteration}.log`), "w");
    const args = ["exec", "turbo", "run", "test", "--filter=@bb/integration-tests", "--concurrency=1", "--force", "--", ...(stage === "focused" ? ["fake/recovery/active-crash-recovery.test.ts", "--maxWorkers=1"] : ["--maxWorkers=4"]), "--silent=false"];
    const result = spawnSync("pnpm", args, { shell: true, stdio: ["ignore", fd, fd], env: process.env });
    closeSync(fd);
    console.log(JSON.stringify({ stage, iteration, status: result.status, signal: result.signal, error: result.error?.message }));
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
