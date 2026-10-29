import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const output = join(process.env.RUNNER_TEMP, "missing-path-results");
const variant = process.env.PROBE_VARIANT;
if (variant !== "baseline" && variant !== "fixed") throw new Error("Invalid variant");
mkdirSync(output, { recursive: true });
function run(pkg, file, name, extra = []) {
  const report = join(output, `${name}.json`);
  const fd = openSync(join(output, `${name}.log`), "w");
  const result = spawnSync("pnpm", ["exec", "turbo", "run", "test", `--filter=${pkg}`, "--force", "--", file, ...extra, "--reporter=json", `--outputFile=${report}`], { shell: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  const data = JSON.parse(readFileSync(report, "utf8"));
  const cases = data.testResults.flatMap(suite => suite.assertionResults);
  return { status: result.status, passed: cases.filter(test => test.status === "passed").length, failed: cases.filter(test => test.status === "failed") };
}
const portable = run("@bb/process-utils", "test/portable-process.test.ts", "portable");
writeFileSync(join(output, "portable-result.json"), JSON.stringify(portable, null, 2));
if (variant === "baseline") {
  const failure = portable.failed[0];
  if (portable.status === 0 || portable.failed.length !== 1 || !failure.fullName.includes("command path cannot be resolved") || !failure.failureMessages.some(message => message.includes("expected true to be false"))) throw new Error("Baseline did not fail the explicit-path spawn regression exclusively");
  console.log("Baseline reproduces false successful spawn; all compatibility cases pass");
} else {
  if (portable.status !== 0 || portable.failed.length !== 0) throw new Error("Fixed portable-process suite failed");
  const repeated = [];
  for (let index = 0; index < 10; index++) {
    const result = run("@bb/provider-bridge-acp", "src/bridge/bridge.test.ts", `acp-${index}`, ["-t", "missing"]);
    repeated.push(result);
    writeFileSync(join(output, "acp-results.json"), JSON.stringify(repeated, null, 2));
    if (result.status !== 0 || result.failed.length !== 0 || result.passed < 2) throw new Error("ACP missing-command checks failed or did not execute");
  }
  console.log("Fixed portable-process suite and ten ACP missing-command repetitions pass");
}
