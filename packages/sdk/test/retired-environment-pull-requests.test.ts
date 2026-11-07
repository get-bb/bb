import { expect, it } from "vitest";
import { BbHttpError } from "../src/response.js";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";

interface Call {
  url: string;
  body: unknown;
}

function sdkWith(respond: (method: string, body: unknown) => Response) {
  const calls: Call[] = [];
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      runtime: "node",
      fetch: async (input, init) => {
        const url = String(input);
        const body: unknown = JSON.parse(String(init?.body));
        calls.push({ url, body });
        return respond(url.split("/").at(-1) ?? "", body);
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

const ok = (result: unknown) => Response.json({ ok: true, result });
const refused = (code: string, message: string, status: number) =>
  Response.json({ ok: false, error: { code, message } }, { status });

const pullRequest = {
  number: 7,
  title: "Fix it",
  state: "open",
  url: "https://github.com/o/r/pull/7",
  baseRefName: "main",
  headRefName: "fix",
  updatedAt: "2026-11-01T00:00:00.000Z",
  autoMerge: false,
  inMergeQueue: false,
  checks: {
    state: "passing",
    totalCount: 1,
    passedCount: 1,
    failedCount: 0,
    pendingCount: 0,
  },
  review: { state: "none", reviewRequestCount: 0 },
  mergeability: {
    state: "mergeable",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  },
  attention: "ready_to_merge",
};

it("returns the environment's row from the GitHub PR Status plugin as the old pullRequest result", async () => {
  const { calls, retired } = sdkWith(() =>
    ok({ env_1: { outcome: "available", pullRequest } }),
  );
  await expect(
    retired("pullRequest")({ environmentId: "env_1" }),
  ).resolves.toEqual({ outcome: "available", pullRequest });
  expect(calls).toEqual([
    {
      url: "http://bb.test/api/v1/plugins/bb--github-pr-status/rpc/pullRequests",
      body: { keys: ["env_1"] },
    },
  ]);
});

it("reports a missing row as unavailable", async () => {
  const { retired } = sdkWith(() => ok({}));
  await expect(
    retired("pullRequest")({ environmentId: "env_1" }),
  ).resolves.toMatchObject({ outcome: "unavailable" });
});

it.each([
  [
    "markPullRequestReady",
    { environmentId: "env_1" },
    "markReady",
    { environmentId: "env_1" },
    "Pull request marked ready",
    { ok: true, action: "pull_request_ready" },
  ],
  [
    "markPullRequestDraft",
    { environmentId: "env_1" },
    "markDraft",
    { environmentId: "env_1" },
    "Pull request converted to draft",
    { ok: true, action: "pull_request_draft" },
  ],
  [
    "mergePullRequest",
    { environmentId: "env_1", method: "squash" },
    "merge",
    { environmentId: "env_1", method: "squash" },
    "Pull request merge started",
    { ok: true, action: "pull_request_merge", method: "squash" },
  ],
])(
  "keeps %s returning its old action result through the plugin",
  async (name, args, method, input, message, shape) => {
    const { calls, retired } = sdkWith(() => ok({ message }));
    await expect(retired(name)(args)).resolves.toEqual({ ...shape, message });
    expect(calls).toEqual([
      {
        url: `http://bb.test/api/v1/plugins/bb--github-pr-status/rpc/${method}`,
        body: input,
      },
    ]);
  },
);

it("maps the plugin's refusals to the old action errors", async () => {
  const notDraft = sdkWith(() =>
    refused("conflict", "Pull request is not a draft", 409),
  );
  const notReady = notDraft.retired("markPullRequestReady")({
    environmentId: "env_1",
  });
  await expect(notReady).rejects.toBeInstanceOf(BbHttpError);
  await expect(notReady).rejects.toMatchObject({
    status: 409,
    code: "pull_request_action_failed",
    message: "HTTP 409: Pull request is not a draft",
  });

  const missing = sdkWith(() =>
    refused("not_found", "Environment not found: env_x", 404),
  );
  await expect(
    missing.retired("mergePullRequest")({
      environmentId: "env_x",
      method: "merge",
    }),
  ).rejects.toMatchObject({ status: 404, code: "environment_not_found" });
});
