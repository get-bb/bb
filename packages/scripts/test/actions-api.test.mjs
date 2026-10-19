import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it, onTestFinished } from "vitest";

const execute = promisify(execFile);

it.each([
  "unavailable",
  "disconnect",
  "rate limit",
  "forbidden",
  "delete",
  "timeout",
  "exhausted",
])(
  "bounds recovery for %s without retrying permanent failures or mutations",
  async (scenario) => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      if (scenario === "timeout" && requests === 1) return;
      if (scenario === "disconnect" && requests === 1) {
        response.destroy();
        return;
      }
      const status =
        scenario === "forbidden"
          ? 403
          : ["delete", "exhausted"].includes(scenario)
            ? 502
            : requests === 1
              ? scenario === "rate limit"
                ? 429
                : 503
              : 200;
      response.writeHead(status, {
        "content-type": "application/json",
        ...(status === 429 ? { "retry-after": "0" } : {}),
      });
      response.end(JSON.stringify({ recovered: true }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    onTestFinished(
      () =>
        new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const apiUrl = new URL(
      "../../../scripts/lib/actions-cache.mjs",
      import.meta.url,
    ).href;
    const child = execute(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { actionsApi } from ${JSON.stringify(apiUrl)}; console.log(JSON.stringify(await actionsApi()("actions/runs", ${JSON.stringify(scenario === "delete" ? "DELETE" : "GET")})));`,
      ],
      {
        env: {
          ...process.env,
          GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
          GITHUB_REPOSITORY: "owner/repo",
          GITHUB_TOKEN: "fixture",
        },
      },
    );
    if (["forbidden", "delete", "exhausted"].includes(scenario)) {
      await expect(child).rejects.toThrow("HTTP");
      expect(requests).toBe(scenario === "exhausted" ? 3 : 1);
    } else {
      expect(JSON.parse((await child).stdout)).toEqual({ recovered: true });
      expect(requests).toBe(2);
    }
  },
  20_000,
);

it("publishes incomplete diagnostics and fails the report when one job inventory remains unavailable", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bb-ci-report-"));
  onTestFinished(() => rm(cwd, { recursive: true, force: true }));
  const timestamp = new Date().toISOString();
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url.includes("workflows/ci.yml/runs")) {
      response.end(
        JSON.stringify({
          total_count: 2,
          workflow_runs: [1, 2].map((id) => ({
            id,
            run_attempt: 1,
            created_at: timestamp,
            conclusion: "success",
            html_url: `https://github.com/owner/repo/actions/runs/${id}`,
            event: "push",
          })),
        }),
      );
    } else if (request.url.includes("runs/1/")) {
      response.writeHead(403);
      response.end("{}");
    } else {
      response.end(
        JSON.stringify({
          jobs: [
            {
              id: 10,
              name: "build",
              run_attempt: 1,
              conclusion: "success",
              started_at: timestamp,
              completed_at: timestamp,
              steps: [],
            },
          ],
        }),
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  await expect(
    execute(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../../scripts/report-ci-health.mjs", import.meta.url),
        ),
      ],
      {
        cwd,
        env: {
          ...process.env,
          GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
          GITHUB_REPOSITORY: "owner/repo",
          GITHUB_TOKEN: "fixture",
          GITHUB_STEP_SUMMARY: join(cwd, "step-summary.md"),
        },
      },
    ),
  ).rejects.toMatchObject({ code: 1 });
  const report = JSON.parse(
    await readFile(join(cwd, ".ci-health/report.json"), "utf8"),
  );
  expect(report).toMatchObject({
    runs: 2,
    incompleteRuns: 1,
    durationSeconds: { count: 1 },
    collection: { inventoryComplete: true, errors: [{ scope: "run 1" }] },
  });
  expect(
    JSON.parse(await readFile(join(cwd, ".ci-health/runs.json"), "utf8")).map(
      (run) => run.jobsComplete,
    ),
  ).toEqual([false, true]);
  expect(await readFile(join(cwd, "step-summary.md"), "utf8")).toContain(
    "INCOMPLETE COLLECTION",
  );
});
