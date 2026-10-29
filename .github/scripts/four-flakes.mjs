import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const output = join(process.env.RUNNER_TEMP, "flake-results");
mkdirSync(output, { recursive: true });
const lane = process.env.PROBE_LANE;
const shards = JSON.parse(readFileSync("scripts/ci-test-shards.json", "utf8"))["windows-tests"];
const shard = shards.find(item => item.shard === (lane === "server" ? "server-1" : "plugins-2"));
const results = [];
function run(name, filters, args, shardValue = "") {
 const fd = openSync(join(output, name + ".log"), "w");
 const started = Date.now();
 const result = spawnSync("pnpm", ["exec", "turbo", "run", "test", ...filters, "--force", "--continue", "--concurrency=" + shard.concurrency, "--", ...args, "--silent=false"], { shell: true, stdio: ["ignore", fd, fd], env: {...process.env, BB_CI_TEST_SHARD: shardValue}, timeout: 600000 });
 closeSync(fd);
 results.push({ name, status: result.status, durationMs: Date.now() - started, error: result.error?.message });
 writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
 console.log(results.at(-1));
}
for (let index=0; index<2; index++) run("shard-"+index, shard.filter.split(" "), [], shard.vitestShard);
for (let index=0; index<10; index++) {
 if (lane === "server") run("profile-"+index, ["--filter=@bb/server"], ["test/system/performance-diagnostics.test.ts"]);
 else run("git-"+index, ["--filter=bb-plugin-git"], ["host/workspace-reads.test.ts"]);
}
