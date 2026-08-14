import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import { createPluginContext } from "../../lib/context.js";
import { AssuranceStudioClient } from "../../lib/remote/assurance-studio/client.js";
import { PlatformClient } from "../../lib/remote/platform/client.js";
import { RemoteLimiter, systemScheduler } from "../../lib/remote/rate-limit.js";
import { registerCachePuller } from "./engine/adapter.js";
import { PullFailedError } from "./engine/pull.js";
import { registerSyncCli } from "./cli.js";

type Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

async function runCli(
  argv: string[],
  options: {
    platformFetch: Fetch;
    assuranceStudioFetch: Fetch;
    platformLimiter?: RemoteLimiter;
    inspectStoredErrors?: (errors: readonly string[]) => void;
  },
) {
  const host = createFakePluginHost({
    pluginId: `finite-state-fs204-${Math.random().toString(36).slice(2)}`,
  });
  const context = createPluginContext(host.bb);
  const platform = new PlatformClient({
    baseUrl: "https://platform.example/api",
    token: "platform-secret",
    fetch: options.platformFetch,
    ...(options.platformLimiter ? { limiter: options.platformLimiter } : {}),
  });
  const assuranceStudio = new AssuranceStudioClient({
    baseUrl: "https://fs-alpha.finitestate.io",
    apiKey: "as-secret",
    fetch: options.assuranceStudioFetch,
  });
  registerCachePuller("finding", async (scope) => {
    let fetched = 0;
    for await (const page of platform.getFindings({
      projectVersionId: scope.projectVersionId ?? "",
      page: { pageSize: 200 },
    })) {
      fetched += page.items.length;
    }
    return {
      fetched,
      baseRows: fetched,
      quarantined: 0,
      advisories: [],
    };
  });
  registerSyncCli(
    host.bb,
    { db: context.db() },
    platform,
    assuranceStudio,
    async () => ({
      worktreeRoot: "/tmp/fs204-registered-cli",
      workspaceProjectId: "bb-project-fs204",
    }),
  );
  try {
    const result = await host.harness.behavior.runCli(argv, {
      cwd: "/untrusted",
      threadId: "thread-fs204",
      projectId: "bb-project-fs204",
    });
    options.inspectStoredErrors?.(
      context
        .db()
        .prepare<[], { error: string }>(
          "SELECT error FROM sync_state WHERE error IS NOT NULL ORDER BY entity_kind",
        )
        .all()
        .map((row) => row.error),
    );
    return result;
  } finally {
    platform.close();
    assuranceStudio.close();
    await host.harness.lifecycle.dispose();
  }
}

const unusedFetch: Fetch = async () => Response.json({ items: [], total: 0 });

describe("registered sync CLI remote diagnostics", () => {
  it("offers a contract-safe pull failure while retaining rich CLI diagnostics", () => {
    const failure = new PullFailedError("generation-1", [
      {
        kind: "finding",
        reasonCode: "authentication",
        message:
          "REMOTE_HTTP_401: Platform authentication failed for GET https://platform.example/api/findings?token=secret using X-Authorization.",
      },
    ]);

    expect(failure.message).toContain("https://platform.example");
    expect(failure.contractSafeMessage).toBe(
      "Pull generation generation-1 did not publish: finding: REMOTE_HTTP_401: remote request failed",
    );
    expect(failure.contractSafeMessage).not.toMatch(
      /(?:authorization|api[_-]?key|token=|https?:\/\/)/iu,
    );
  });

  it("prints the Platform 401 diagnostic when a pull hits the remote", async () => {
    const platformFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ error: "unauthorized" }, { status: 401 }),
    );
    let storedErrors: readonly string[] = [];
    const result = await runCli(
      [
        "finite-state",
        "pull",
        "finding",
        "--project",
        "platform-project",
        "--version",
        "platform-version",
      ],
      {
        platformFetch,
        assuranceStudioFetch: unusedFetch,
        inspectStoredErrors: (errors) => {
          storedErrors = errors;
        },
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "Pull complete: 0 published, 1 failed\n" +
        "finding: failed · 0 fetched, 0 base rows, 0 quarantined · authentication=1\n",
    );
    expect(platformFetch).toHaveBeenCalledTimes(1);
    expect(storedErrors).toEqual(["REMOTE_HTTP_401: remote request failed"]);
  });

  it("prints an immediate Platform 401 credential line", async () => {
    const platformFetch = vi.fn(async () =>
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );
    const result = await runCli(["finite-state", "as-projects"], {
      platformFetch,
      assuranceStudioFetch: unusedFetch,
    });

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        "Platform authentication failed for GET https://platform.example/api/public/v0/projects?offset=0&limit=200 with HTTP 401 using X-Authorization. Refresh Platform token (platformToken).\n",
    });
    expect(platformFetch).toHaveBeenCalledTimes(1);
  });

  it("prints an immediate Assurance Studio 401 credential line", async () => {
    const assuranceStudioFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ error: "X-API-Key required" }, { status: 401 }),
    );
    const result = await runCli(
      ["finite-state", "as-projects", "--project", "platform-project"],
      {
        platformFetch: unusedFetch,
        assuranceStudioFetch,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(
      /^Assurance Studio authentication failed for GET https:\/\/fs-alpha\.finitestate\.io\/api\/.+ with HTTP 401 using X-API-Key\. Refresh Assurance Studio API key \(asApiKey\)\.\n$/u,
    );
    expect(assuranceStudioFetch).toHaveBeenCalledTimes(1);
    const headers = new Headers(
      assuranceStudioFetch.mock.calls[0]?.[1]?.headers,
    );
    expect(headers.get("X-API-Key")).toBe("as-secret");
    expect(headers.has("Authorization")).toBe(false);
  });

  it("keeps a genuine network failure classified as unreachable", async () => {
    const platformFetch = vi.fn(async () => {
      throw new TypeError("connection refused");
    });
    const limiter = new RemoteLimiter({
      concurrency: 1,
      maxAttempts: 1,
      maxBackoffMs: 1,
      scheduler: systemScheduler,
      random: () => 0,
    });
    const result = await runCli(["finite-state", "as-projects"], {
      platformFetch,
      assuranceStudioFetch: unusedFetch,
      platformLimiter: limiter,
    });

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        "Platform could not be reached during GET https://platform.example/api/public/v0/projects?offset=0&limit=200. Check DNS, proxy, and network connectivity.\n",
    });
    expect(platformFetch).toHaveBeenCalledTimes(1);
  });
});
