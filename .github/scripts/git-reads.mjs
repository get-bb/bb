import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const output = join(process.env.RUNNER_TEMP, "git-read-results");
mkdirSync(output, { recursive: true });
const file = "plugins/git/host/workspace-reads.test.ts";
const fixed = readFileSync(file, "utf8");
const baseline = execFileSync("git", ["show", "abcff9f053:" + file], { encoding: "utf8" });
const results = [];
function instrument(source) {
 const start = source.indexOf('  it("resolves remote-only merge bases');
 const end = source.indexOf("\n  it(", start+5);
 const body = source.slice(start,end).replace("    const repoPath =", "    const probeStarted = performance.now();\n    const repoPath =").replace("    ).toBe(0);", '    ).toBe(0);\n    console.error("REMOTE_BASE_DURATION", performance.now() - probeStarted);');
 return source.slice(0,start)+body+source.slice(end);
}
for (const [index, variant] of ["before", "after", "after", "before"].entries()) {
 writeFileSync(file, instrument(variant === "before" ? baseline : fixed));
 const name = index + "-" + variant;
 const path = join(output, name + ".log");
 const fd = openSync(path, "w");
 const started = Date.now();
 const result = spawnSync("pnpm", ["exec", "turbo", "run", "test", "--filter=bb-plugin-*", "--filter=!bb-plugin-provider-*", "--filter=!bb-plugin-tasks", "--filter=!bb-plugin-connect", "--filter=!bb-plugin-thread-list", "--force", "--continue", "--concurrency=2", "--", "--silent=false"], { shell: true, stdio: ["ignore", fd, fd], timeout: 600000 });
 closeSync(fd);
 const log = readFileSync(path, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
 const timings = [...log.matchAll(/REMOTE_BASE_DURATION (\d+(?:\.\d+)?)/g)].map(match=>Number(match[1]));
 const row = { name, status:result.status, durationMs:Date.now()-started, timings, error:result.error?.message };
 results.push(row);
 writeFileSync(join(output,"results.json"), JSON.stringify(results,null,2));
 console.log(row);
 if(timings.length !== 1) throw new Error("Target did not execute to completion exactly once");
}
