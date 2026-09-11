import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const fake = vi.hoisted(() => ({
  calls: [] as string[][],
  failedRepos: new Set<string>(),
  latency: 0,
}));

vi.mock("node:child_process", () => ({
  execFile(
    file: string,
    args: string[],
    _options: object,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) {
    if (file !== "gh") throw new Error(`Unexpected executable: ${file}`);
    fake.calls.push(args);
    const list = args[1] === "graphql";
    const failed =
      list &&
      fake.failedRepos.has(
        `owner/${args.find((arg) => arg.startsWith("name="))?.slice(5)}`,
      );
    const finish = () =>
      callback(
        failed ? new Error("offline") : null,
        JSON.stringify({
          data: {
            repository: {
              hasIssuesEnabled: true,
              openIssues: { nodes: [] },
              closedIssues: { nodes: [] },
              openPrs: { nodes: [] },
              closedPrs: { nodes: [] },
            },
          },
        }),
        "",
      );
    if (list && fake.latency) setTimeout(finish, fake.latency);
    else finish();
  },
}));

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
const lists = () => fake.calls.filter((args) => args[1] === "graphql");

beforeEach(() => {
  vi.useFakeTimers();
  fake.calls = [];
  fake.failedRepos.clear();
  fake.latency = 0;
});

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
  vi.useRealTimers();
});

async function start(count: number) {
  const host = createFakePluginHost({
    pluginId: "github",
    settings: {
      extraRepos: Array.from(
        { length: count },
        (_, i) => `owner/repo-${i}`,
      ).join(","),
    },
    sdk: { projects: { list: async () => [] } },
  });
  hosts.push(host);
  await plugin(host.bb);
  const service = host.harness.runService("sync");
  await vi.advanceTimersByTimeAsync(0);
  return { ...host, ...service };
}

it.each([0, 1, 34])(
  "waits fifteen minutes between sweeps for %i repos",
  async (count) => {
    const { controller, done } = await start(count);
    expect(lists()).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(15 * 60_000 - 1);
    expect(lists()).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(1);
    expect(lists()).toHaveLength(2 * count);
    expect(fake.calls.filter((args) => args[0] === "auth")).toHaveLength(3);
    controller.abort();
    await done;
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("uses one bounded GraphQL request for each repository", async () => {
  await start(2);
  expect(lists()).toHaveLength(2);
  for (const [i, args] of lists().entries()) {
    expect(args.slice(0, 4)).toEqual([
      "api",
      "graphql",
      "--hostname",
      "github.com",
    ]);
    expect(args).toContain("owner=owner");
    expect(args).toContain(`name=repo-${i}`);
    expect(args).not.toContain("--paginate");
    const query = args.find((arg) => arg.startsWith("query="))!;
    expect(query).toContain("openIssues: issues(first: 100, states: [OPEN]");
    expect(query).toContain("closedIssues: issues(first: 50, states: [CLOSED]");
    expect(query).toContain("openPrs: pullRequests(first: 50, states: [OPEN]");
    expect(query).toContain(
      "closedPrs: pullRequests(first: 30, states: [CLOSED, MERGED]",
    );
    expect(
      query.match(/orderBy: {field: CREATED_AT, direction: DESC}/g),
    ).toHaveLength(4);
    expect(query).toContain("labels(first: 100)");
    expect(query).toContain("assignees(first: 100)");
  }
});

it("allows immediate RPC and CLI refresh during the background wait", async () => {
  const { harness } = await start(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await harness.callRpc("refresh")).toEqual({ repos: 1, items: 0 });
  expect(lists()).toHaveLength(2);
  expect((await harness.runCli(["sync"])).exitCode).toBe(0);
  expect(lists()).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(14 * 60_000 - 1);
  expect(lists()).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(lists()).toHaveLength(4);
});

it("measures the wait from completion and does not overlap repository sweeps", async () => {
  fake.latency = 1000;
  await start(2);
  expect(lists()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(lists()).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1000);
  fake.latency = 0;
  await vi.advanceTimersByTimeAsync(15 * 60_000 - 1);
  expect(lists()).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(lists()).toHaveLength(4);
});

it("finishes an in-flight sweep on abort without scheduling another", async () => {
  fake.latency = 1000;
  const { controller, done } = await start(2);
  controller.abort();
  await vi.advanceTimersByTimeAsync(2000);
  await done;
  expect(lists()).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(lists()).toHaveLength(2);
});

it("preserves all-repository failure backoff and resets it after recovery", async () => {
  fake.failedRepos.add("owner/repo-0");
  const { bb } = await start(1);
  let count = 1;
  for (const delay of [30, 60, 120, 240, 300, 300]) {
    await vi.advanceTimersByTimeAsync(delay * 1000 - 1);
    expect(lists()).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(1);
    count += 1;
    expect(lists()).toHaveLength(count);
  }
  expect(await bb.storage.kv.get("sync-cursor")).toBeUndefined();
  fake.failedRepos.clear();
  await vi.advanceTimersByTimeAsync(300_000);
  count += 1;
  expect(await bb.storage.kv.get("sync-cursor")).toBeDefined();
  fake.failedRepos.add("owner/repo-0");
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  count += 1;
  expect(lists()).toHaveLength(count);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(lists()).toHaveLength(count + 1);
});

it("uses the normal background wait after a partial repository failure", async () => {
  fake.failedRepos.add("owner/repo-0");
  const { bb } = await start(2);
  expect(await bb.storage.kv.get("sync-cursor")).toBeDefined();
  await vi.advanceTimersByTimeAsync(15 * 60_000 - 1);
  expect(lists()).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(lists()).toHaveLength(4);
});
