import { describe, expect, it } from "vitest";
import { createBbSdk } from "../src/core.js";
import type { FetchImplementation } from "../src/response.js";
import { createHttpTransport } from "../src/transport-http.js";

const plugin = {
  id: "notes",
  source: "npm:notes",
  rootDir: "/plugins/notes",
  version: "1.0.0",
  provenance: "direct",
  isOrphanedBuiltin: false,
  publisherLabel: null,
  sourceDisplay: "npm · notes",
  updateState: {},
  enabled: true,
  description: null,
  name: "Notes",
  screenshots: [],
  collections: [],
  icon: null,
  iconUrl: null,
  status: "running",
  statusDetail: null,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  capabilities: [],
  hasSettings: false,
  app: { hasApp: false, bundle: null },
  logoUrl: null,
  logoDarkUrl: null,
  providerIds: [],
  icons: {},
};

const job = {
  id: "job-1",
  target: { kind: "source", source: "npm:notes", selection: { kind: "root" } },
  displayName: "npm:notes",
};

function serverWithJobStates(states: readonly object[]) {
  const requests: { url: string; prefer: string | null }[] = [];
  let polls = 0;
  const fetch: FetchImplementation = async (input, init) => {
    const url = String(input);
    requests.push({ url, prefer: new Headers(init?.headers).get("prefer") });
    const body = url.endsWith("/api/v1/plugins/install")
      ? { ok: true, job: { ...job, state: "queued" } }
      : { job: { ...job, ...states[Math.min(polls++, states.length - 1)] } };
    return new Response(JSON.stringify(body), {
      status: url.endsWith("/install") ? 202 : 200,
      headers: { "content-type": "application/json" },
    });
  };
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      fetch,
      runtime: "node",
    }),
  });
  return { sdk, requests };
}

describe("plugin installs through server jobs", () => {
  it("asks for a job and waits for it to install the plugin", async () => {
    const { sdk, requests } = serverWithJobStates([
      { state: "running" },
      { state: "succeeded", plugin },
    ]);

    await expect(sdk.plugins.install({ source: "npm:notes" })).resolves.toEqual(
      plugin,
    );
    expect(requests[0]).toEqual({
      url: "http://bb.test/api/v1/plugins/install",
      prefer: "respond-async",
    });
    expect(requests.slice(1).map((request) => request.url)).toEqual([
      "http://bb.test/api/v1/plugins/install-jobs/job-1",
      "http://bb.test/api/v1/plugins/install-jobs/job-1",
    ]);
  });

  it.each([
    {
      state: { state: "failed", error: "npm install failed" },
      message: "npm install failed",
    },
    { state: { state: "cancelled" }, message: "install cancelled" },
  ])("throws when the job ends $state.state", async ({ state, message }) => {
    const { sdk } = serverWithJobStates([state]);

    await expect(sdk.plugins.install({ source: "npm:notes" })).rejects.toThrow(
      message,
    );
  });
});
