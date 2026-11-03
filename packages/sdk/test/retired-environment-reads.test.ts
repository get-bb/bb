import { expect, it } from "vitest";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";

interface Call {
  url: string;
  body: unknown;
}

function sdkWith(result: (method: string, body: unknown) => unknown) {
  const calls: Call[] = [];
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      runtime: "node",
      fetch: async (input, init) => {
        const url = String(input);
        const body: unknown = JSON.parse(String(init?.body));
        calls.push({ url, body });
        const method = url.split("/").at(-1) ?? "";
        return Response.json({ ok: true, result: result(method, body) });
      },
    }),
  });
  const retired = (name: string) => {
    const member: unknown = Reflect.get(sdk.environments, name);
    if (typeof member !== "function") throw new Error(`${name} is missing`);
    return (args: object): Promise<unknown> =>
      Reflect.apply(member, sdk.environments, [args]);
  };
  return { calls, retired };
}

it("keeps retired environment status working through the Git plugin", async () => {
  const status = { outcome: "not_applicable", reason: "non_git_environment" };
  const { calls, retired } = sdkWith(() => status);
  await expect(
    retired("status")({ environmentId: "env_1", mergeBaseBranch: "main" }),
  ).resolves.toEqual(status);
  expect(calls).toEqual([
    {
      url: "http://bb.test/api/v1/plugins/bb--git/rpc/workspaceStatus",
      body: { environmentId: "env_1", mergeBaseBranch: "main" },
    },
  ]);
});

it("reassembles retired diffPatch results from keyed patch rows", async () => {
  const { calls, retired } = sdkWith((_method, body) => {
    const keys = (body as { keys: string[] }).keys;
    return Object.fromEntries(
      keys.map((key) => {
        const path = (JSON.parse(key) as unknown[])[3] as string;
        return [
          key,
          {
            outcome: "available",
            patch: { path, patch: `patch ${path}`, truncated: false },
          },
        ];
      }),
    );
  });
  await expect(
    retired("diffPatch")({
      environmentId: "env_1",
      target: { type: "uncommitted" },
      paths: ["b.ts", "a.ts"],
    }),
  ).resolves.toEqual({
    outcome: "available",
    patches: [
      { path: "b.ts", patch: "patch b.ts", truncated: false },
      { path: "a.ts", patch: "patch a.ts", truncated: false },
    ],
  });
  expect(calls[0]?.url).toBe(
    "http://bb.test/api/v1/plugins/bb--git/rpc/patches",
  );
});

it("maps retired branch and diff arguments to the Git plugin's inputs", async () => {
  const { calls, retired } = sdkWith(() => null);
  await retired("diffBranches")({
    environmentId: "env_1",
    query: "  feat ",
    limit: "20",
  });
  await retired("diffFiles")({
    environmentId: "env_1",
    target: "all",
    mergeBaseBranch: "main",
  });
  expect(calls.map((call) => call.body)).toEqual([
    { environmentId: "env_1", query: "feat", limit: 20 },
    {
      environmentId: "env_1",
      target: { type: "all", mergeBaseBranch: "main" },
      ignoreWhitespace: false,
    },
  ]);
});

it("keeps the retired Viewed methods working through the Git plugin", async () => {
  const { calls, retired } = sdkWith((method) =>
    method === "viewed"
      ? { files: [{ path: "a.ts", revision: "rev-a" }] }
      : { ok: true },
  );
  await expect(
    retired("experimental_diffViewed")({
      environmentId: "env_1",
      target: "commit",
      sha: "abc1234",
      paths: ["a.ts"],
    }),
  ).resolves.toEqual({ files: [{ path: "a.ts", revision: "rev-a" }] });
  await expect(
    retired("experimental_markDiffViewed")({
      environmentId: "env_1",
      target: { type: "uncommitted" },
      path: "a.ts",
      revision: "rev-a",
    }),
  ).resolves.toEqual({ ok: true });
  await retired("experimental_clearDiffViewed")({
    environmentId: "env_1",
    target: { type: "uncommitted" },
  });
  expect(calls).toEqual([
    {
      url: "http://bb.test/api/v1/plugins/bb--git/rpc/viewed",
      body: {
        environmentId: "env_1",
        target: { type: "commit", sha: "abc1234" },
        paths: ["a.ts"],
      },
    },
    {
      url: "http://bb.test/api/v1/plugins/bb--git/rpc/markViewed",
      body: {
        environmentId: "env_1",
        target: { type: "uncommitted" },
        path: "a.ts",
        revision: "rev-a",
      },
    },
    {
      url: "http://bb.test/api/v1/plugins/bb--git/rpc/clearViewed",
      body: { environmentId: "env_1", target: { type: "uncommitted" } },
    },
  ]);
});
