import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const output = join(process.env.RUNNER_TEMP, "fix-results");
mkdirSync(output, { recursive: true });
const lane = process.env.PROBE_LANE;
const file = lane === "codex" ? "plugins/provider-codex/src/bridge/bridge.writer-lock.test.ts" : "plugins/github-pr-status/host/batch.test.ts";
const pkg = lane === "codex" ? "bb-plugin-provider-codex" : "bb-plugin-bb--github-pr-status";
const relative = lane === "codex" ? "src/bridge/bridge.writer-lock.test.ts" : "host/batch.test.ts";
const fixed = readFileSync(file, "utf8");
const baseline = execFileSync("git", ["show", "2096c06effec14ece292ad03a79417081d9ac534:" + file], { encoding: "utf8" });
const results = [];
function run(name) {
 const report = join(output, name + ".json");
 const fd = openSync(join(output, name + ".log"), "w");
 const result = spawnSync("pnpm", ["exec", "turbo", "run", "test", "--filter=" + pkg, "--force", "--", relative, "--reporter=json", "--outputFile=" + report], { shell: true, stdio: ["ignore", fd, fd], timeout: 120000 });
 closeSync(fd);
 const data = JSON.parse(readFileSync(report, "utf8"));
 const tests = data.testResults.flatMap(suite => suite.assertionResults);
 const row = {name, status:result.status, passed: tests.filter(test=>test.status === "passed").length, failed:tests.filter(test=>test.status === "failed"), timings:tests.map(test=>({name:test.fullName,duration:test.duration}))};
 results.push(row);
 writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
 console.log(name, result.status, row.passed, row.failed.length);
 return row;
}
if (lane === "codex") {
 const fakePath = "plugins/provider-codex/src/bridge/fake-codex-app-server.mjs";
 const fake = readFileSync(fakePath, "utf8");
 writeFileSync(fakePath, fake.replace('    case "initialize":', '    case "initialize":\n      await new Promise((resolve) => setTimeout(resolve, 800));'));
 writeFileSync(file, baseline);
 const before = run("slow-before");
 if (before.status === 0 || before.failed.length !== 1 || !before.failed[0].fullName.includes("discard maintenance") || !before.failed[0].failureMessages.some(message=>message.includes("length of 2") && message.includes("got 3"))) throw new Error("Unexpected baseline failure");
 writeFileSync(file, fixed);
 if (run("slow-after").status !== 0) throw new Error("Gated test failed slow schedule");
 writeFileSync(fakePath, fake);
 for (let index=0;index<8;index++) if(run("normal-"+index).status !== 0) throw new Error("Gated repetition failed");
} else {
 for (const [index, variant] of ["before", "after", "after", "before"].entries()) {
  writeFileSync(file, variant === "before" ? baseline : fixed);
  if(run(index + "-" + variant).status !== 0) throw new Error("Batch comparison failed");
 }
}
