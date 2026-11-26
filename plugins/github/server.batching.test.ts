import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { githubRpcContract } from "./server";

const fake = vi.hoisted(() => ({
  responses: new Map<string, string | Error>(),
  calls: [] as string[][],
}));
vi.mock("@get-bb/plugin-sdk/process", () => ({
  experimental_execHostFileCallback(
    file: string,
    args: string[],
    options: { timeout: number; maxBuffer: number },
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) {
    if (file !== "gh") throw new Error(`Unexpected executable ${file}`);
    fake.calls.push(args);
    if (args[0] === "--version" || args[0] === "auth")
      return callback(null, "ok", "");
    expect(options).toEqual({ timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    const name = args.find((arg) => arg.startsWith("name="))?.slice(5);
    const response = fake.responses.get(name ?? "");
    if (response === undefined)
      return callback(new Error("unexpected command"), "", "");
    if (response instanceof Error)
      return callback(response, "", response.message);
    callback(null, response, "");
  },
}));

function node(number: number, state = "OPEN") {
  return {
    number,
    state,
    title: `Title ${number}`,
    author: { login: "robot[bot]" },
    labels: { nodes: [{ name: "bug" }] },
    assignees: { nodes: [{ login: "alice" }] },
    body: "Body\ntext",
    url: `https://github.com/acme/one/issues/${number}`,
    updatedAt: "2026-09-10T00:00:00Z",
  };
}
function repository() {
  return {
    hasIssuesEnabled: true,
    openIssues: { nodes: [node(1)] },
    closedIssues: { nodes: [node(2, "CLOSED")] },
    openPrs: { nodes: [node(3)] },
    closedPrs: { nodes: [node(4, "CLOSED"), node(5, "MERGED")] },
  };
}
function response(repo = repository()) {
  return JSON.stringify({ data: { repository: repo } });
}
const hosts: ReturnType<typeof createFakePluginHost>[] = [];
beforeEach(() => {
  fake.responses.clear();
  fake.calls = [];
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});
async function start(repos = "acme/one") {
  const host = createFakePluginHost({
    pluginId: "github",
    settings: { extraRepos: repos },
    sdk: { projects: { list: async () => [] } },
  });
  hosts.push(host);
  await plugin(host.bb);
  return host;
}

it("maps all four lists into SQLite and preserves closed/merged filtering", async () => {
  fake.responses.set("one", response());
  const { harness, bb } = await start();
  expect(await harness.behavior.callRpc("refresh")).toEqual({
    repos: 1,
    items: 5,
  });
  expect(
    bb.storage.database().prepare("SELECT count(*) AS n FROM items").get(),
  ).toEqual({ n: 5 });
  const { items } = githubRpcContract.listItems.output.parse(
    await harness.behavior.callRpc("listItems", { state: "closed" }),
  );
  expect(items.map((item: { state: string }) => item.state).sort()).toEqual([
    "CLOSED",
    "CLOSED",
    "MERGED",
  ]);
  expect(
    await harness.behavior.callRpc("listItems", {
      kind: "issue",
      state: "open",
    }),
  ).toEqual({
    items: [
      {
        repo: "acme/one",
        kind: "issue",
        number: 1,
        state: "OPEN",
        title: "Title 1",
        author: "app/robot[bot]",
        labels: ["bug"],
        assignees: ["alice"],
        body: "Body\ntext",
        url: "https://github.com/acme/one/issues/1",
        updatedAt: "2026-09-10T00:00:00Z",
      },
    ],
  });
  expect(fake.calls.filter((args) => args[1] === "graphql")).toHaveLength(1);
});

it("accepts deleted authors and empty connections, discards disabled issues, and clears stale rows on success", async () => {
  fake.responses.set("one", response());
  const { harness } = await start();
  await harness.behavior.callRpc("refresh");
  const repo = {
    ...repository(),
    hasIssuesEnabled: false,
    openPrs: {
      nodes: [
        {
          ...node(3),
          author: null,
          labels: { nodes: [] },
          assignees: { nodes: [] },
        },
      ],
    },
    closedPrs: { nodes: [] },
  };
  fake.responses.set("one", JSON.stringify({ data: { repository: repo } }));
  expect(await harness.behavior.callRpc("refresh")).toEqual({
    repos: 1,
    items: 1,
  });
  expect(await harness.behavior.callRpc("listItems", {})).toMatchObject({
    items: [{ number: 3, author: "app/", labels: [], assignees: [] }],
  });
  fake.responses.set(
    "one",
    response({
      hasIssuesEnabled: true,
      openIssues: { nodes: [] },
      closedIssues: { nodes: [] },
      openPrs: { nodes: [] },
      closedPrs: { nodes: [] },
    }),
  );
  expect(await harness.behavior.callRpc("refresh")).toEqual({
    repos: 1,
    items: 0,
  });
  expect(await harness.behavior.callRpc("listItems", {})).toEqual({
    items: [],
  });
});

it.each([
  ["process failure", new Error("timeout")],
  ["invalid JSON", "broken"],
  ["null repository", JSON.stringify({ data: { repository: null } })],
  [
    "missing alias",
    JSON.stringify({
      data: { repository: { ...repository(), closedPrs: undefined } },
    }),
  ],
  [
    "partial GraphQL error",
    JSON.stringify({
      data: { repository: repository() },
      errors: [
        { message: "resource limit", path: ["repository", "openIssues"] },
      ],
    }),
  ],
  [
    "null connection",
    JSON.stringify({
      data: { repository: { ...repository(), openIssues: null } },
    }),
  ],
  [
    "malformed node",
    response({
      ...repository(),
      openIssues: { nodes: [{ ...node(1), number: -1 }] },
    }),
  ],
])(
  "retains repository rows and cursor after %s, then allows another repository to succeed",
  async (_name, failed) => {
    fake.responses.set("one", response());
    const { harness, bb } = await start();
    await harness.behavior.callRpc("refresh");
    const before = await harness.behavior.callRpc("listItems", {});
    const cursor = await bb.storage.kv.get("sync-cursor");
    fake.responses.set("one", failed);
    await expect(harness.behavior.callRpc("refresh")).rejects.toThrow();
    expect(await harness.behavior.callRpc("listItems", {})).toEqual(before);
    expect(await bb.storage.kv.get("sync-cursor")).toEqual(cursor);
    await harness.behavior.setSettings({ extraRepos: "acme/one,acme/two" });
    fake.responses.set("two", response());
    expect(await harness.behavior.callRpc("refresh")).toEqual({
      repos: 2,
      items: 5,
    });
    expect(
      await harness.behavior.callRpc("listItems", { repo: "acme/one" }),
    ).toEqual(before);
    expect(
      bb.storage.database().prepare("SELECT count(*) AS n FROM items").get(),
    ).toEqual({ n: 10 });
  },
);

it("answers a mention search with the newest 8 open matches through the index", async () => {
  const openIssues = [3, 9, 1, 7, 5, 2, 8, 4, 6].map((number) => ({
    ...node(number),
    updatedAt: `2026-09-1${number}T00:00:00Z`,
  }));
  fake.responses.set(
    "one",
    response({
      ...repository(),
      openIssues: { nodes: openIssues },
      closedIssues: { nodes: [node(20, "CLOSED")] },
      openPrs: { nodes: [node(30)] },
    }),
  );
  const { harness, bb } = await start();
  await harness.behavior.callRpc("refresh");
  const provider = harness.registrations.mentionProviders.find(
    (candidate) => candidate.id === "issue",
  );
  if (provider === undefined) throw new Error("issue provider missing");
  const db = bb.storage.database();
  const prepare = vi.spyOn(db, "prepare");
  const results = provider.search({
    query: "title",
    trigger: "@",
    projectId: "project-1",
    threadId: "thread-1",
    experimental_signal: new AbortController().signal,
  });
  const statements = prepare.mock.calls.map(([source]) => source);
  prepare.mockRestore();

  expect(results).toEqual(
    [9, 8, 7, 6, 5, 4, 3, 2].map((number) => ({
      id: `acme/one#${number}`,
      title: `#${number} Title ${number}`,
      subtitle: "acme/one",
    })),
  );
  expect(statements).toHaveLength(1);
  const [statement] = statements;
  const placeholders = statement.split("?").length - 1;
  const plan = db
    .prepare(`EXPLAIN QUERY PLAN ${statement}`)
    .all(...Array<null>(placeholders).fill(null)) as { detail: string }[];
  expect(plan.map((row) => row.detail)).toEqual([
    expect.stringMatching(/^SEARCH items USING INDEX /),
  ]);
});
