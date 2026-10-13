import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  pluginInstallJobListResponseSchema,
  pluginInstallJobStartResponseSchema,
  type InstalledPlugin,
  type PluginInstallJob,
} from "@bb/server-contract";
import {
  commitInstall,
  PluginInstallCancelledError,
  runCancellableInstall,
} from "../../../src/services/plugins/install-cancellation.js";
import { runInstallCommand } from "../../../src/services/plugins/install-sources.js";
import { createPluginInstallJobs } from "../../../src/services/plugins/plugin-install-jobs.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";
let PLUGIN: InstalledPlugin;

beforeAll(async () => {
  PLUGIN = await withTestHarness((h) =>
    h.pluginService.install("builtin:keep-awake", { kind: "root" }),
  );
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sourceTarget(source: string) {
  return {
    kind: "source" as const,
    source,
    selection: { kind: "root" as const },
  };
}

describe("plugin install jobs", () => {
  it("runs installs one at a time and folds a repeat request into the active job", async () => {
    const jobs = createPluginInstallJobs({ notifyChanged: () => {} });
    const first = deferred<InstalledPlugin>();
    const second = vi.fn(async () => PLUGIN);

    const a = jobs.start({
      target: sourceTarget("npm:a"),
      displayName: "a",
      run: () => first.promise,
    });
    const b = jobs.start({
      target: sourceTarget("npm:b"),
      displayName: "b",
      run: second,
    });
    const repeat = jobs.start({
      target: sourceTarget("npm:a"),
      displayName: "a",
      run: async () => PLUGIN,
    });

    expect(repeat.id).toBe(a.id);
    expect(jobs.list().map((job) => job.state)).toEqual(["running", "queued"]);
    expect(second).not.toHaveBeenCalled();

    first.resolve(PLUGIN);
    await expect(jobs.settled(b.id)).resolves.toMatchObject({
      state: "succeeded",
    });
    expect(jobs.get(a.id)?.state).toBe("succeeded");
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("drops a cancelled queued install without starting it", async () => {
    const jobs = createPluginInstallJobs({ notifyChanged: () => {} });
    const first = deferred<InstalledPlugin>();
    const queuedRun = vi.fn(async () => PLUGIN);
    jobs.start({
      target: sourceTarget("npm:a"),
      displayName: "a",
      run: () => first.promise,
    });
    const queued = jobs.start({
      target: sourceTarget("npm:b"),
      displayName: "b",
      run: queuedRun,
    });

    expect(jobs.cancel(queued.id)?.state).toBe("cancelled");
    first.resolve(PLUGIN);
    await vi.waitFor(() => {
      expect(jobs.list().every((job) => job.state !== "running")).toBe(true);
    });
    expect(queuedRun).not.toHaveBeenCalled();
  });

  it.each([
    { outcome: "rejects", expected: "cancelled" },
    { outcome: "resolves", expected: "succeeded" },
  ] as const)(
    "reports a cancelled running install as $expected when it $outcome",
    async ({ outcome, expected }) => {
      const jobs = createPluginInstallJobs({ notifyChanged: () => {} });
      const run = deferred<InstalledPlugin>();
      const job = jobs.start({
        target: sourceTarget("npm:a"),
        displayName: "a",
        run: () => run.promise,
      });

      expect(jobs.cancel(job.id)?.state).toBe("cancelling");
      if (outcome === "rejects") run.reject(new PluginInstallCancelledError());
      else run.resolve(PLUGIN);

      await expect(jobs.settled(job.id)).resolves.toMatchObject({
        state: expected,
      });
    },
  );

  it("reports a failure with its message and forgets finished jobs after ten minutes", async () => {
    let now = 0;
    const jobs = createPluginInstallJobs({
      notifyChanged: () => {},
      now: () => now,
    });
    const job = jobs.start({
      target: sourceTarget("npm:a"),
      displayName: "a",
      run: async () => {
        throw new Error("npm install failed");
      },
    });

    await expect(jobs.settled(job.id)).resolves.toEqual({
      ...job,
      state: "failed",
      error: "npm install failed",
    });
    now = 10 * 60_000 - 1;
    expect(jobs.get(job.id)).toBeDefined();
    now = 10 * 60_000;
    expect(jobs.get(job.id)).toBeUndefined();
  });
});

describe("install cancellation", () => {
  const sleeper = [
    "-e",
    "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'inherit' }); setTimeout(() => {}, 60_000)",
  ];

  it("kills the running install command and its children when the install is cancelled", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const command = runCancellableInstall(controller.signal, () =>
      runInstallCommand(process.execPath, sleeper),
    );
    setTimeout(() => controller.abort(), 50);

    await expect(command).rejects.toBeInstanceOf(PluginInstallCancelledError);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("refuses to register a cancelled install and ignores cancellation once registered", async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      runCancellableInstall(cancelled.signal, async () => commitInstall()),
    ).rejects.toBeInstanceOf(PluginInstallCancelledError);

    const committed = new AbortController();
    await expect(
      runCancellableInstall(committed.signal, async () => {
        commitInstall();
        committed.abort();
        return runInstallCommand(process.execPath, ["-e", "1"]);
      }),
    ).resolves.toBe("");
  });
});

describe("plugin install routes", () => {
  async function postInstall(
    app: TestAppHarness["app"],
    headers: Record<string, string>,
  ): Promise<Response> {
    return app.request(`${BASE}/api/v1/plugins/install`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ source: "builtin:keep-awake" }),
    });
  }

  it("answers a respond-async install with a job the list reports through completion", async () => {
    await withTestHarness(async (h) => {
      const notify = vi.spyOn(h.hub, "notifySystem");
      const response = await postInstall(h.app, { prefer: "respond-async" });

      expect(response.status).toBe(202);
      const { job } = pluginInstallJobStartResponseSchema.parse(
        await response.json(),
      );
      let listed: PluginInstallJob | undefined;
      await vi.waitFor(async () => {
        const list = await h.app.request(`${BASE}/api/v1/plugins/install-jobs`);
        listed = pluginInstallJobListResponseSchema
          .parse(await list.json())
          .jobs.find((candidate) => candidate.id === job.id);
        expect(listed?.state).toBe("succeeded");
      });
      expect(listed).toMatchObject({ plugin: { id: "keep-awake" } });
      expect(notify).toHaveBeenCalledWith(["plugin-install-jobs-changed"]);
    });
  });

  it("still answers a plain install request with the installed plugin", async () => {
    await withTestHarness(async (h) => {
      const response = await postInstall(h.app, {});

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        plugin: { id: "keep-awake", status: "running" },
      });
    });
  });

  it("answers 404 for a job the server does not know", async () => {
    await withTestHarness(async (h) => {
      for (const [path, method] of [
        ["/api/v1/plugins/install-jobs/missing", "GET"],
        ["/api/v1/plugins/install-jobs/missing/cancel", "POST"],
      ] as const) {
        const response = await h.app.request(`${BASE}${path}`, { method });
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({
          error: "unknown install job; the server may have restarted",
        });
      }
    });
  });

  it("refuses an unknown catalog entry before starting a job", async () => {
    await withTestHarness(async (h) => {
      const response = await h.app.request(
        `${BASE}/api/v1/plugin-catalog/install`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            prefer: "respond-async",
          },
          body: JSON.stringify({ entryId: "does-not-exist" }),
        },
      );

      expect(response.status).toBe(422);
      const list = await h.app.request(`${BASE}/api/v1/plugins/install-jobs`);
      await expect(list.json()).resolves.toEqual({ jobs: [] });
    });
  });
});
