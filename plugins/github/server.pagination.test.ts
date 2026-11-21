import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { githubRpcContract } from "./server";

const upstream = vi.hoisted(() => ({
  openIssues: [] as number[],
  openPrs: [] as number[],
  queries: [] as string[],
  failAfter: null as string | null,
}));

vi.mock("@get-bb/plugin-sdk/process", () => ({
  experimental_execHostFileCallback(
    file: string,
    args: string[],
    _options: object,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) {
    if (file !== "gh") throw new Error(`Unexpected executable ${file}`);
    if (args[0] === "--version" || args[0] === "auth")
      return callback(null, "ok", "");
    const query = args.find((arg) => arg.startsWith("query="))!;
    const after = args.find((arg) => arg.startsWith("after="))?.slice(6);
    upstream.queries.push(query);
    if (after !== undefined && after === upstream.failAfter)
      return callback(new Error("rate limited"), "", "API rate limit exceeded");
    const connection = (numbers: number[], size: number, offset = 0) => {
      const end = Math.min(offset + size, numbers.length);
      return {
        nodes: numbers.slice(offset, end).map((number) => ({
          number,
          state: "OPEN",
          title: `Title ${number}`,
          author: { login: "alice", id: "U_1" },
          labels: { nodes: [] },
          assignees: { nodes: [] },
          body: "",
          url: `https://github.com/acme/one/issues/${number}`,
          updatedAt: "2026-09-10T00:00:00Z",
        })),
        pageInfo:
          end < numbers.length
            ? { hasNextPage: true, endCursor: String(end) }
            : { hasNextPage: false, endCursor: null },
      };
    };
    const size = Number(query.match(/\(first: (\d+)/)![1]);
    const repository =
      after === undefined
        ? {
            hasIssuesEnabled: true,
            openIssues: connection(upstream.openIssues, size),
            closedIssues: { nodes: [] },
            openPrs: connection(
              upstream.openPrs,
              Number(query.match(/openPrs: pullRequests\(first: (\d+)/)![1]),
            ),
            closedPrs: { nodes: [] },
          }
        : {
            page: connection(
              query.includes("pullRequests(")
                ? upstream.openPrs
                : upstream.openIssues,
              size,
              Number(after),
            ),
          };
    callback(null, JSON.stringify({ data: { repository } }), "");
  },
}));

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
beforeEach(() => {
  upstream.openIssues = [];
  upstream.openPrs = [];
  upstream.queries = [];
  upstream.failAfter = null;
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});

async function start() {
  const host = createFakePluginHost({
    pluginId: "github",
    settings: { extraRepos: "acme/one" },
    sdk: { projects: { list: async () => [] } },
  });
  hosts.push(host);
  await plugin(host.bb);
  return host.harness;
}

const descending = (count: number) =>
  Array.from({ length: count }, (_, index) => count - index);

async function openNumbers(
  harness: Awaited<ReturnType<typeof start>>,
  kind: "issue" | "pr",
) {
  const { items } = githubRpcContract.listItems.output.parse(
    await harness.behavior.callRpc("listItems", { kind, state: "open" }),
  );
  return items.map((item) => item.number).sort((a, b) => a - b);
}

it("follows pageInfo so open issues and PRs beyond the first page stay cached", async () => {
  upstream.openIssues = descending(100);
  const harness = await start();
  await harness.behavior.callRpc("refresh");
  expect(await openNumbers(harness, "issue")).toContain(1);
  upstream.openIssues = descending(250);
  upstream.openPrs = descending(120);
  expect(await harness.behavior.callRpc("refresh")).toEqual({
    repos: 1,
    items: 370,
  });
  expect(await openNumbers(harness, "issue")).toEqual(
    descending(250).reverse(),
  );
  expect(await openNumbers(harness, "pr")).toEqual(descending(120).reverse());
});

it("stops at the page cap and keeps cached rows when a later page fails", async () => {
  upstream.openIssues = descending(1_050);
  const harness = await start();
  expect(await harness.behavior.callRpc("refresh")).toEqual({
    repos: 1,
    items: 1_000,
  });
  expect(upstream.queries).toHaveLength(10);
  const before = await openNumbers(harness, "issue");
  upstream.openIssues = descending(1_051);
  upstream.failAfter = "100";
  await expect(harness.behavior.callRpc("refresh")).rejects.toThrow();
  expect(await openNumbers(harness, "issue")).toEqual(before);
});
