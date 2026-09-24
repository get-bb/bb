import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import { isAllowedBaseUrl, resolveDefaultBaseUrl } from "./base-url.js";
import {
  ADOPT_CONNECT_CREDENTIAL_METHOD,
  FETCH_METHOD,
  STATUS_METHOD,
  WAIT_FOR_STATUS_CHANGE_METHOD,
  type AccountStatus,
  type LoginView,
} from "./contract.js";
import { createBbAccountPlugin } from "./plugin.js";
import { CREDENTIAL_KV_KEY, PROFILE_KV_KEY, REVISION_KV_KEY } from "./store.js";
import { StubGetbb } from "./testing/stub-getbb.js";

const FAST_TIMING = {
  minIntervalMs: 0,
  maxIntervalMs: 2_000,
  slowDownStepMs: 150,
  marginMs: 0,
};

const TEST_OPTIONS = {
  timing: FAST_TIMING,
  allowedBaseUrl: (origin: string) => origin.startsWith("http://127.0.0.1:"),
};

const AS_CONNECT = {
  experimental_caller: { kind: "plugin", pluginId: "connect" },
} as const;

let stub: StubGetbb;
const hosts: FakePluginHost[] = [];

beforeEach(async () => {
  stub = await StubGetbb.start();
});

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
  await stub.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function loadAccount(
  seed?: (host: FakePluginHost) => Promise<void>,
): Promise<FakePluginHost> {
  const host = createFakePluginHost({ pluginId: "bb-account" });
  hosts.push(host);
  await seed?.(host);
  await createBbAccountPlugin(TEST_OPTIONS)(host.bb);
  return host;
}

async function status(host: FakePluginHost): Promise<AccountStatus> {
  return (await host.harness.callRpc(STATUS_METHOD, {})) as AccountStatus;
}

async function signInWithCode(host: FakePluginHost): Promise<AccountStatus> {
  stub.issueRedeemCode("ABCD-EFGH");
  return (await host.harness.callRpc("redeemCode", {
    code: "ABCD-EFGH",
    baseUrl: stub.apexUrl,
  })) as AccountStatus;
}

async function seedSignedIn(
  host: FakePluginHost,
  profile: { name?: string } = {},
): Promise<string> {
  const credential = stub.issueCredential();
  await host.bb.storage.kv.set(CREDENTIAL_KV_KEY, {
    baseUrl: stub.apexUrl,
    serverUrl: stub.gateUrl,
    serverId: "srv_1",
    credential,
  });
  await host.bb.storage.kv.set(PROFILE_KV_KEY, {
    userId: "usr_1",
    githubLogin: "sawyerhood",
    name: profile.name ?? "Sawyer Hood",
    avatarUrl: null,
    handle: "sawyer",
    serverId: "srv_1",
    serverLabel: "sawyer-desktop",
    serverUrl: stub.gateUrl,
  });
  return credential;
}

async function waitForLogin(
  host: FakePluginHost,
  loginId: string,
  state: LoginView["state"],
): Promise<LoginView> {
  let view: LoginView | null = null;
  await vi.waitFor(
    async () => {
      const result = (await host.harness.callRpc("login.poll", {
        loginId,
      })) as { login: LoginView | null };
      view = result.login;
      expect(view?.state).toBe(state);
    },
    { timeout: 5_000 },
  );
  return view!;
}

describe("base URL", () => {
  it("uses the worktree-local Cloud only in development", () => {
    expect(resolveDefaultBaseUrl({})).toBe("https://getbb.app");
    expect(
      resolveDefaultBaseUrl({
        NODE_ENV: "production",
        BB_DEV_CONNECT_BASE_URL: "http://bb.localhost:59329",
      }),
    ).toBe("https://getbb.app");
    expect(
      resolveDefaultBaseUrl({
        NODE_ENV: "development",
        BB_DEV_CONNECT_BASE_URL: "http://bb.localhost:59329/",
      }),
    ).toBe("http://bb.localhost:59329");
    expect(
      resolveDefaultBaseUrl({
        NODE_ENV: "development",
        BB_DEV_CONNECT_BASE_URL: "https://vibecodethis.site",
      }),
    ).toBe("https://vibecodethis.site");
    for (const value of [
      "https://bb.localhost:59329",
      "http://evil.test:59329",
      "http://bb.localhost",
      "http://bb.localhost:1/path",
      "http://vibecodethis.site",
      "https://vibecodethis.site.evil.test",
      "https://vibecodethis.site/link",
    ]) {
      expect(() =>
        resolveDefaultBaseUrl({
          NODE_ENV: "development",
          BB_DEV_CONNECT_BASE_URL: value,
        }),
      ).toThrow("BB_DEV_CONNECT_BASE_URL");
    }
  });
});

describe("bb account sign-in", () => {
  it("starts signed out and answers fetch with a local 401", async () => {
    const host = await loadAccount();
    const initial = await status(host);
    expect(initial).toEqual({
      state: "signed-out",
      revision: expect.any(Number),
      account: null,
    });
    await expect(
      host.harness.callRpc(FETCH_METHOD, {
        target: "api",
        method: "GET",
        path: "/api/ai/v1/usage",
        body: null,
      }),
    ).resolves.toEqual({ status: 401, body: { error: "signed-out" } });
    expect(stub.requests).toEqual([]);
  });

  it("signs in with a pasted code and stores the credential, never returning it", async () => {
    const host = await loadAccount();
    const before = await status(host);
    const after = await signInWithCode(host);

    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after).toMatchObject({
      state: "signed-in",
      account: {
        userId: "usr_1",
        githubLogin: "sawyerhood",
        name: "Sawyer Hood",
        handle: "sawyer",
        serverId: "srv_1",
        serverLabel: "sawyer-desktop",
        serverUrl: stub.gateUrl,
        baseUrl: stub.apexUrl,
      },
    });
    const stored = (await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)) as {
      credential: string;
      serverUrl: string;
    };
    expect(stored.credential).toMatch(/^bbcred_/u);
    expect(stored.serverUrl).toBe(stub.gateUrl);
    expect(JSON.stringify(after)).not.toContain(stored.credential);
    const me = stub.requestsTo("/api/account/me")[0]!;
    expect(me.authorization).toBe(`Bearer ${stored.credential}`);
    expect(me.machineHeader).toBe(stored.credential);
    expect(
      host.harness.realtimeSignals.some(
        (signal) =>
          signal.channel === "account" &&
          (signal.payload as { status: AccountStatus }).status.state ===
            "signed-in",
      ),
    ).toBe(true);
    expect(
      host.harness.logEntries.some((entry) =>
        entry.message.includes(stored.credential),
      ),
    ).toBe(false);
  });

  it("maps redeem failures to typed codes without storing anything", async () => {
    const host = await loadAccount();
    stub.issueRedeemCode("USED-CODE");
    await host.harness.callRpc("redeemCode", {
      code: "USED-CODE",
      baseUrl: stub.apexUrl,
    });
    await host.harness.callRpc("signOut", null);
    stub.issueRedeemCode("OLD1-CODE", { expired: true });

    await expect(
      host.harness.callRpc("redeemCode", {
        code: "USED-CODE",
        baseUrl: stub.apexUrl,
      }),
    ).rejects.toThrow("already_used");
    await expect(
      host.harness.callRpc("redeemCode", {
        code: "OLD1-CODE",
        baseUrl: stub.apexUrl,
      }),
    ).rejects.toThrow("expired_code");
    await expect(
      host.harness.callRpc("redeemCode", {
        code: "NOPE-NOPE",
        baseUrl: stub.apexUrl,
      }),
    ).rejects.toThrow("invalid_code");
    expect(await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)).toBeUndefined();
  });

  it("signs in through a browser link once getbb.app approves it", async () => {
    const host = await loadAccount();
    const view = (await host.harness.callRpc("login.start", {
      baseUrl: stub.apexUrl,
    })) as LoginView;

    expect(view).toMatchObject({
      state: "pending",
      verificationUrl: `${stub.apexUrl}/link?code=${view.userCode}`,
    });
    expect(JSON.stringify(view)).not.toContain("dev_");
    const start = stub.requestsTo("/api/account/link/start")[0]!;
    expect(start.body).toEqual({ clientName: expect.any(String) });
    expect(
      (start.body as { clientName: string }).clientName.length,
    ).toBeGreaterThan(0);

    await vi.waitFor(() =>
      expect(stub.linkPolls(view.userCode)).toBeGreaterThan(1),
    );
    expect((await status(host)).state).toBe("signed-out");

    stub.approveLink(view.userCode);
    await waitForLogin(host, view.id, "signed-in");
    expect(await status(host)).toMatchObject({
      state: "signed-in",
      account: { serverLabel: "sawyer-desktop", serverUrl: stub.gateUrl },
    });
  });

  it("reuses a pending link and reports denial and expiry", async () => {
    const host = await loadAccount();
    const first = (await host.harness.callRpc("login.start", {
      baseUrl: stub.apexUrl,
    })) as LoginView;
    const again = (await host.harness.callRpc("login.start", {
      baseUrl: stub.apexUrl,
    })) as LoginView;
    expect(again.id).toBe(first.id);

    stub.denyLink(first.userCode);
    const denied = await waitForLogin(host, first.id, "denied");
    expect(denied.message).toContain("denied");

    const second = (await host.harness.callRpc("login.start", {
      baseUrl: stub.apexUrl,
    })) as LoginView;
    expect(second.id).not.toBe(first.id);
    stub.expireLink(second.userCode);
    await waitForLogin(host, second.id, "expired");
    expect((await status(host)).state).toBe("signed-out");
  });

  it("backs off when getbb.app asks it to slow down", async () => {
    const host = await loadAccount();
    const pollTimes: number[] = [];
    let slowDowns = 2;
    stub.linkIntervalMs = 10;
    const view = (await host.harness.callRpc("login.start", {
      baseUrl: stub.apexUrl,
    })) as LoginView;
    stub.route("POST", "/api/account/link/poll", () => {
      pollTimes.push(Date.now());
      if (slowDowns > 0) {
        slowDowns -= 1;
        return { status: 429, body: { error: "slow-down" } };
      }
      return { status: 200, body: { status: "pending" } };
    });

    await vi.waitFor(() => expect(pollTimes.length).toBeGreaterThanOrEqual(4), {
      timeout: 5_000,
    });
    const gaps = pollTimes
      .slice(1)
      .map((time, index) => time - pollTimes[index]!);
    expect(gaps[0]).toBeGreaterThanOrEqual(150);
    expect(gaps[1]).toBeGreaterThanOrEqual(300);
    await host.harness.callRpc("login.cancel", { loginId: view.id });
  });

  it("cancels a pending link", async () => {
    const host = await loadAccount();
    const view = (await host.harness.callRpc("login.start", {
      baseUrl: stub.apexUrl,
    })) as LoginView;
    const cancelled = (await host.harness.callRpc("login.cancel", {
      loginId: view.id,
    })) as { login: LoginView };
    expect(cancelled.login.state).toBe("cancelled");
    const polls = stub.requestsTo("/api/account/link/poll").length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stub.requestsTo("/api/account/link/poll").length).toBe(polls);
  });
});

describe("bb-account.v1.fetch", () => {
  it("sends the credential to the fixed origin for each target", async () => {
    const host = await loadAccount();
    await signInWithCode(host);
    const credential = (
      (await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)) as {
        credential: string;
      }
    ).credential;
    stub.route("GET", "/api/connect/servers", () => ({
      status: 200,
      body: {
        servers: [{ handle: "sawyer-desktop", name: "Desk", live: true }],
      },
    }));
    stub.route("POST", "/api/ai/v1/complete", (request) => ({
      status: 200,
      body: { echoed: request.body },
    }));

    const gate = await host.harness.callRpc(
      FETCH_METHOD,
      {
        target: "gate",
        method: "GET",
        path: "/api/connect/servers",
        body: null,
      },
      AS_CONNECT,
    );
    const api = await host.harness.callRpc(FETCH_METHOD, {
      target: "api",
      method: "POST",
      path: "/api/ai/v1/complete",
      body: { prompt: "title this" },
    });

    expect(gate).toEqual({
      status: 200,
      body: {
        servers: [{ handle: "sawyer-desktop", name: "Desk", live: true }],
      },
    });
    expect(api).toEqual({
      status: 200,
      body: { echoed: { prompt: "title this" } },
    });
    const [servers] = stub.requestsTo("/api/connect/servers");
    const [complete] = stub.requestsTo("/api/ai/v1/complete");
    expect(servers).toMatchObject({
      site: "gate",
      authorization: `Bearer ${credential}`,
      machineHeader: credential,
    });
    expect(complete).toMatchObject({
      site: "apex",
      authorization: `Bearer ${credential}`,
      machineHeader: credential,
    });
    expect(JSON.stringify([gate, api])).not.toContain(credential);
  });

  it.each([
    "/api/../admin",
    "/api//evil.test/x",
    "/api/x?next=https://evil.test",
    "/api/x#frag",
    "/other/path",
    "/api/account/me",
    "/api/auth/list-sessions",
    "/api/%2e%2e/admin",
    "/api/x\\y",
    "https://evil.test/api/x",
  ])("refuses the path %s without a network call", async (path) => {
    const host = await loadAccount();
    await signInWithCode(host);
    const requestsBefore = stub.requests.length;
    await expect(
      host.harness.callRpc(
        FETCH_METHOD,
        { target: "api", method: "GET", path, body: null },
        AS_CONNECT,
      ),
    ).rejects.toThrow();
    expect(stub.requests.length).toBe(requestsBefore);
  });

  it("caps request and response bodies at 1 MB and never follows redirects", async () => {
    const host = await loadAccount();
    await signInWithCode(host);
    stub.route("GET", "/api/ai/huge", () => ({
      status: 200,
      body: { blob: "x".repeat(1024 * 1024) },
    }));
    stub.route("GET", "/api/ai/redirect", () => ({ status: 302 }));

    await expect(
      host.harness.callRpc(FETCH_METHOD, {
        target: "api",
        method: "POST",
        path: "/api/ai/echo",
        body: { blob: "x".repeat(1024 * 1024) },
      }),
    ).rejects.toThrow("1 MB");
    expect(stub.requestsTo("/api/ai/echo")).toEqual([]);
    await expect(
      host.harness.callRpc(FETCH_METHOD, {
        target: "api",
        method: "GET",
        path: "/api/ai/huge",
        body: null,
      }),
    ).rejects.toThrow("1 MB");
    await expect(
      host.harness.callRpc(FETCH_METHOD, {
        target: "api",
        method: "GET",
        path: "/api/ai/redirect",
        body: null,
      }),
    ).resolves.toEqual({ status: 302, body: null });
  });

  it("signs out, clears the credential, and bumps the revision on an upstream 401", async () => {
    const host = await loadAccount();
    const signedIn = await signInWithCode(host);
    const credential = (
      (await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)) as {
        credential: string;
      }
    ).credential;
    stub.revoke(credential);

    const waiting = host.harness.callRpc(WAIT_FOR_STATUS_CHANGE_METHOD, {
      afterRevision: signedIn.revision,
    });
    const result = await host.harness.callRpc(
      FETCH_METHOD,
      {
        target: "api",
        method: "POST",
        path: "/api/connect/tunnel-ticket",
        body: null,
      },
      AS_CONNECT,
    );

    expect(result).toEqual({ status: 401, body: { error: "unauthorized" } });
    const woke = (await waiting) as AccountStatus;
    expect(woke.state).toBe("signed-out");
    expect(woke.revision).toBeGreaterThan(signedIn.revision);
    expect(await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)).toBeUndefined();
    expect(await host.bb.storage.kv.get(PROFILE_KV_KEY)).toBeUndefined();
    const requests = stub.requests.length;
    await expect(
      host.harness.callRpc(
        FETCH_METHOD,
        {
          target: "api",
          method: "POST",
          path: "/api/connect/tunnel-ticket",
          body: null,
        },
        AS_CONNECT,
      ),
    ).resolves.toEqual({ status: 401, body: { error: "signed-out" } });
    expect(stub.requests.length).toBe(requests);
  });
});

describe("bb-account.v1.waitForStatusChange", () => {
  it("returns at once for an older revision and wakes waiters on sign-in", async () => {
    const host = await loadAccount();
    const current = await status(host);
    await expect(
      host.harness.callRpc(WAIT_FOR_STATUS_CHANGE_METHOD, {
        afterRevision: current.revision - 1,
      }),
    ).resolves.toEqual(current);

    const waiting = host.harness.callRpc(WAIT_FOR_STATUS_CHANGE_METHOD, {
      afterRevision: current.revision,
    });
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    await signInWithCode(host);
    await expect(waiting).resolves.toMatchObject({ state: "signed-in" });
  });

  it("answers with the unchanged status after 25 seconds", async () => {
    const host = await loadAccount();
    const current = await status(host);
    vi.useFakeTimers();
    const waiting = host.harness.callRpc(WAIT_FOR_STATUS_CHANGE_METHOD, {
      afterRevision: current.revision,
    });
    await vi.advanceTimersByTimeAsync(24_000);
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(waiting).resolves.toEqual(current);
  });

  it("keeps revisions increasing across reloads", async () => {
    const host = await loadAccount();
    const first = await status(host);
    const reloaded = await host.harness.reload(
      createBbAccountPlugin(TEST_OPTIONS),
    );
    hosts.push(reloaded);
    const second = (await reloaded.harness.callRpc(
      STATUS_METHOD,
      {},
    )) as AccountStatus;
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(await reloaded.bb.storage.kv.get(REVISION_KV_KEY)).toBe(
      second.revision,
    );
  });
});

describe("sign-out, profile refresh, and adoption", () => {
  it("revokes on getbb.app, then forgets the credential", async () => {
    const host = await loadAccount();
    await signInWithCode(host);
    const credential = (
      (await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)) as {
        credential: string;
      }
    ).credential;

    const after = (await host.harness.callRpc("signOut", null)) as {
      revocation: string;
      status: AccountStatus;
    };

    expect(after).toMatchObject({
      revocation: "revoked",
      status: { state: "signed-out" },
    });
    expect(stub.requestsTo("/api/connect/disconnect")[0]).toMatchObject({
      site: "gate",
      method: "POST",
      machineHeader: credential,
      authorization: `Bearer ${credential}`,
    });
    expect(stub.isValid(credential)).toBe(false);
    expect(await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)).toBeUndefined();
  });

  it("still signs out locally when getbb.app is unreachable, and says it wasn't revoked", async () => {
    const host = await loadAccount();
    await signInWithCode(host);
    const apexUrl = stub.apexUrl;
    await stub.close();
    const after = (await host.harness.callRpc("signOut", null)) as {
      revocation: string;
      status: AccountStatus;
      dashboardUrl: string;
      message: string;
    };
    expect(after).toMatchObject({
      revocation: "failed",
      status: { state: "signed-out" },
      dashboardUrl: `${apexUrl}/dashboard`,
      message: expect.stringContaining("couldn't reach"),
    });
    expect(await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)).toBeUndefined();
    expect(
      host.harness.logEntries.some((entry) =>
        entry.message.includes("did not confirm the sign-out"),
      ),
    ).toBe(true);
    stub = await StubGetbb.start();
  });

  it("refreshes the cached profile at start and signs out when it is rejected", async () => {
    let credential = "";
    const host = await loadAccount(async (seeded) => {
      credential = await seedSignedIn(seeded, { name: "Old Name" });
    });
    const cached = await status(host);
    expect(cached).toMatchObject({
      state: "signed-in",
      account: { name: "Old Name" },
    });

    const { controller, done } = host.harness.runService("profile-refresh");
    await vi.waitFor(async () => {
      const refreshed = await status(host);
      expect(refreshed.account?.name).toBe("Sawyer Hood");
      expect(refreshed.revision).toBeGreaterThan(cached.revision);
    });
    controller.abort();
    await done;

    stub.revoke(credential);
    const again = host.harness.runService("profile-refresh");
    await vi.waitFor(async () => {
      expect((await status(host)).state).toBe("signed-out");
    });
    again.controller.abort();
    await again.done;
  });

  it("adopts a legacy connect credential only while signed out, and revokes one it doesn't adopt", async () => {
    const host = await loadAccount();
    const legacy = stub.issueCredential();

    await expect(
      host.harness.callRpc(
        ADOPT_CONNECT_CREDENTIAL_METHOD,
        { credential: "bbcred_revoked", baseUrl: stub.apexUrl },
        AS_CONNECT,
      ),
    ).resolves.toEqual({ adopted: false });
    expect((await status(host)).state).toBe("signed-out");

    await expect(
      host.harness.callRpc(
        ADOPT_CONNECT_CREDENTIAL_METHOD,
        { credential: legacy, baseUrl: stub.apexUrl },
        AS_CONNECT,
      ),
    ).resolves.toEqual({ adopted: true });
    expect(await status(host)).toMatchObject({
      state: "signed-in",
      account: { serverLabel: "sawyer-desktop", baseUrl: stub.apexUrl },
    });
    await expect(
      host.harness.callRpc(
        ADOPT_CONNECT_CREDENTIAL_METHOD,
        { credential: legacy, baseUrl: stub.apexUrl },
        AS_CONNECT,
      ),
    ).resolves.toEqual({ adopted: true });
    expect(stub.isValid(legacy)).toBe(true);

    const other = stub.issueCredential({ serverId: "srv_2" });
    await expect(
      host.harness.callRpc(
        ADOPT_CONNECT_CREDENTIAL_METHOD,
        { credential: other, baseUrl: stub.apexUrl },
        AS_CONNECT,
      ),
    ).resolves.toEqual({ adopted: false });
    expect(stub.isValid(other)).toBe(false);
    expect(stub.isValid(legacy)).toBe(true);
    expect(
      (
        (await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)) as {
          credential: string;
        }
      ).credential,
    ).toBe(legacy);
  });

  it("fails adoption without a verdict when getbb.app can't validate it", async () => {
    const host = await loadAccount();
    stub.route("GET", "/api/account/me", () => ({
      status: 404,
      body: { error: "not-found" },
    }));
    await expect(
      host.harness.callRpc(
        ADOPT_CONNECT_CREDENTIAL_METHOD,
        { credential: stub.issueCredential(), baseUrl: stub.apexUrl },
        AS_CONNECT,
      ),
    ).rejects.toThrow("HTTP 404");
    expect((await status(host)).state).toBe("signed-out");
  });

  it("publishes discoverable methods and keeps the private ones unlisted", async () => {
    const host = await loadAccount();
    expect(host.harness.registrations.rpcMethods).toEqual(
      expect.arrayContaining([
        STATUS_METHOD,
        WAIT_FOR_STATUS_CHANGE_METHOD,
        FETCH_METHOD,
        ADOPT_CONNECT_CREDENTIAL_METHOD,
        "login.start",
        "login.poll",
        "login.cancel",
        "redeemCode",
        "signOut",
      ]),
    );
    const published =
      host.harness.registrations.experimental_publishedRpcMethods;
    expect(published.map((method) => method.method).sort()).toEqual(
      [FETCH_METHOD, STATUS_METHOD, WAIT_FOR_STATUS_CHANGE_METHOD].sort(),
    );
    const fetchSchema = published.find(
      (method) => method.method === FETCH_METHOD,
    );
    expect(fetchSchema?.inputSchema).toMatchObject({
      properties: {
        target: { enum: ["api", "gate"] },
        method: { enum: ["GET", "POST"] },
      },
    });
  });
});

describe("bb account CLI", () => {
  it("reports status, pairs with a code, and signs out", async () => {
    const host = await loadAccount();
    const signedOut = await host.harness.runCli(["status"]);
    expect(signedOut.stdout).toContain("Not signed in");

    stub.issueRedeemCode("CODE-1234");
    const paired = await host.harness.runCli([
      "login",
      "--code",
      "CODE-1234",
      "--base-url",
      stub.apexUrl,
    ]);
    expect(paired.exitCode).toBe(0);
    expect(paired.stdout).toContain("Signed in as Sawyer Hood (@sawyerhood)");
    expect(paired.stdout).toContain("sawyer-desktop");

    const json = await host.harness.runCli(["status", "--json"]);
    expect(JSON.parse(json.stdout)).toMatchObject({
      state: "signed-in",
      account: { handle: "sawyer" },
      login: null,
    });

    const logout = await host.harness.runCli(["logout"]);
    expect(logout.stdout).toContain("Signed out");
    expect((await status(host)).state).toBe("signed-out");
  });

  it("prints a link and code, then waits for approval with --wait", async () => {
    const host = await loadAccount();
    const started = await host.harness.runCli([
      "login",
      "--base-url",
      stub.apexUrl,
      "--json",
    ]);
    const { login } = JSON.parse(started.stdout) as { login: LoginView };
    const text = await host.harness.runCli([
      "login",
      "--base-url",
      stub.apexUrl,
    ]);
    expect(text.stdout).toContain(login.verificationUrl);
    expect(text.stdout).toContain(login.userCode);
    expect(text.stdout).toContain("bb account login --wait");

    const waiting = host.harness.runCli(["login", "--wait"]);
    await vi.waitFor(() =>
      expect(stub.linkPolls(login.userCode)).toBeGreaterThan(0),
    );
    stub.approveLink(login.userCode);
    const done = await waiting;
    expect(done.exitCode).toBe(0);
    expect(done.stdout).toContain("Signed in as Sawyer Hood");
  });

  it("fails --wait clearly when nothing is pending or the link is denied", async () => {
    const host = await loadAccount();
    const nothing = await host.harness.runCli(["login", "--wait"]);
    expect(nothing.exitCode).toBe(1);
    expect(nothing.stderr).toContain("no sign-in is in progress");

    await host.harness.runCli(["login", "--base-url", stub.apexUrl]);
    const view = (
      (await host.harness.callRpc("login.poll", { loginId: null })) as {
        login: LoginView;
      }
    ).login;
    const waiting = host.harness.runCli(["login", "--wait", "--json"]);
    stub.denyLink(view.userCode);
    const denied = await waiting;
    expect(denied.exitCode).toBe(1);
    expect(JSON.parse(denied.stdout)).toMatchObject({
      ok: false,
      error: { code: "login_denied" },
    });
  });

  it("rejects a bad code with the dashboard hint", async () => {
    const host = await loadAccount();
    const result = await host.harness.runCli([
      "login",
      "--code",
      "BAD0-CODE",
      "--base-url",
      stub.apexUrl,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid or has expired");
  });
});

describe("who may use bb account", () => {
  it("lets any caller reach /api/ai/ and only connect reach /api/connect/", async () => {
    const host = await loadAccount();
    await signInWithCode(host);
    stub.route("POST", "/api/ai/v1/complete", () => ({
      status: 200,
      body: { ok: true },
    }));
    const request = {
      target: "api",
      method: "POST",
      path: "/api/connect/tunnel-ticket",
      body: null,
    };

    for (const caller of [
      undefined,
      { experimental_caller: { kind: "client" } } as const,
      {
        experimental_caller: { kind: "plugin", pluginId: "bb-ai" },
      } as const,
    ]) {
      await expect(
        host.harness.callRpc(FETCH_METHOD, request, caller),
      ).rejects.toThrow("only the connect plugin");
      await expect(
        host.harness.callRpc(
          FETCH_METHOD,
          { ...request, path: "/api/ai/v1/complete" },
          caller,
        ),
      ).resolves.toEqual({ status: 200, body: { ok: true } });
    }
    expect(stub.requestsTo("/api/connect/tunnel-ticket")).toEqual([]);

    await expect(
      host.harness.callRpc(FETCH_METHOD, request, AS_CONNECT),
    ).resolves.toMatchObject({ status: 200 });
    expect(stub.requestsTo("/api/connect/tunnel-ticket")).toHaveLength(1);
  });

  it("refuses credential adoption from anyone but connect", async () => {
    const host = await loadAccount();
    const legacy = stub.issueCredential();
    for (const caller of [
      undefined,
      {
        experimental_caller: { kind: "plugin", pluginId: "bb-ai" },
      } as const,
    ]) {
      await expect(
        host.harness.callRpc(
          ADOPT_CONNECT_CREDENTIAL_METHOD,
          { credential: legacy, baseUrl: stub.apexUrl },
          caller,
        ),
      ).rejects.toThrow("only the connect plugin");
    }
    expect(stub.requests).toEqual([]);
    expect((await status(host)).state).toBe("signed-out");
  });

  it("gives up on getbb.app after the caller's timeout and bounds it", async () => {
    const host = await loadAccount();
    await signInWithCode(host);
    const release = stub.hold("GET", "/api/ai/v1/slow");
    const started = Date.now();
    await expect(
      host.harness.callRpc(FETCH_METHOD, {
        target: "api",
        method: "GET",
        path: "/api/ai/v1/slow",
        body: null,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
    release();
    for (const timeoutMs of [999, 15_001, 1_500.5]) {
      await expect(
        host.harness.callRpc(FETCH_METHOD, {
          target: "api",
          method: "GET",
          path: "/api/ai/v1/usage",
          body: null,
          timeoutMs,
        }),
      ).rejects.toThrow("rpc input validation failed");
    }
    expect((await status(host)).state).toBe("signed-in");
  });

  it("keeps the credential when a 401 comes from something other than the credential", async () => {
    const host = await loadAccount();
    const signedIn = await signInWithCode(host);
    stub.route("GET", "/api/ai/v1/typo", () => ({
      status: 401,
      body: { error: "sign in" },
    }));
    const meBefore = stub.requestsTo("/api/account/me").length;

    await expect(
      host.harness.callRpc(FETCH_METHOD, {
        target: "api",
        method: "GET",
        path: "/api/ai/v1/typo",
        body: null,
      }),
    ).resolves.toEqual({ status: 401, body: { error: "sign in" } });

    expect(stub.requestsTo("/api/account/me").length).toBe(meBefore + 1);
    expect(await status(host)).toMatchObject({
      state: "signed-in",
      revision: signedIn.revision,
    });
    expect(await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)).toBeDefined();
  });
});

describe("base URL overrides", () => {
  it("allows only getbb.app and staging, plus bb.localhost in development", () => {
    for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "test" }]) {
      expect(isAllowedBaseUrl("https://getbb.app", env)).toBe(true);
      expect(isAllowedBaseUrl("https://vibecodethis.site", env)).toBe(true);
      expect(isAllowedBaseUrl("http://bb.localhost:59329", env)).toBe(false);
    }
    const development = { NODE_ENV: "development" };
    expect(isAllowedBaseUrl("http://bb.localhost:59329", development)).toBe(
      true,
    );
    for (const origin of [
      "https://evil.test",
      "http://getbb.app",
      "https://sawyer.getbb.app",
      "https://getbb.app.evil.test",
      "http://127.0.0.1:59329",
      "https://bb.localhost:59329",
      "http://bb.localhost",
    ]) {
      expect(isAllowedBaseUrl(origin, development), origin).toBe(false);
    }
  });

  it("refuses to sign in to another origin before any request", async () => {
    const host = createFakePluginHost({ pluginId: "bb-account" });
    hosts.push(host);
    await createBbAccountPlugin()(host.bb);

    const cli = await host.harness.runCli([
      "login",
      "--code",
      "ABCD-EFGH",
      "--base-url",
      stub.apexUrl,
    ]);
    expect(cli.exitCode).toBe(1);
    expect(cli.stderr).toContain(
      "https://getbb.app or https://vibecodethis.site",
    );
    await expect(
      host.harness.callRpc("login.start", { baseUrl: "https://evil.test" }),
    ).rejects.toThrow("https://getbb.app or https://vibecodethis.site");
    expect(stub.requests).toEqual([]);
  });
});

describe("sign-in races", () => {
  async function approvedLoginWaitingOnProfile(host: FakePluginHost): Promise<{
    view: LoginView;
    release: () => void;
  }> {
    const view = (await host.harness.callRpc("login.start", {
      baseUrl: stub.apexUrl,
    })) as LoginView;
    const release = stub.hold("GET", "/api/account/me");
    stub.approveLink(view.userCode);
    await vi.waitFor(() =>
      expect(stub.requestsTo("/api/account/me").length).toBeGreaterThan(0),
    );
    return { view, release };
  }

  function mintedLinkCredential(): string {
    const [me] = stub.requestsTo("/api/account/me");
    return me!.authorization!.slice("Bearer ".length);
  }

  it("does not sign in when the sign-in is cancelled while it finishes", async () => {
    const host = await loadAccount();
    const { view, release } = await approvedLoginWaitingOnProfile(host);
    const minted = mintedLinkCredential();

    const cancelled = (await host.harness.callRpc("login.cancel", {
      loginId: view.id,
    })) as { login: LoginView };
    expect(cancelled.login.state).toBe("cancelled");
    release();

    await vi.waitFor(() => expect(stub.isValid(minted)).toBe(false));
    expect((await status(host)).state).toBe("signed-out");
    expect(await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)).toBeUndefined();
    const poll = (await host.harness.callRpc("login.poll", {
      loginId: view.id,
    })) as { login: LoginView };
    expect(poll.login.state).toBe("cancelled");
  });

  it("does not sign back in when the user signs out while a sign-in finishes", async () => {
    const host = await loadAccount();
    const { view, release } = await approvedLoginWaitingOnProfile(host);

    await expect(host.harness.callRpc("signOut", null)).resolves.toMatchObject({
      revocation: "not-signed-in",
    });
    release();

    await waitForLogin(host, view.id, "cancelled");
    await vi.waitFor(() =>
      expect(stub.isValid(mintedLinkCredential())).toBe(false),
    );
    expect((await status(host)).state).toBe("signed-out");
  });

  it("cancels a pending link on sign-out so approving it later does nothing", async () => {
    const host = await loadAccount();
    await signInWithCode(host);
    const view = (await host.harness.callRpc("login.start", {
      baseUrl: stub.apexUrl,
    })) as LoginView;

    await host.harness.callRpc("signOut", null);
    await waitForLogin(host, view.id, "cancelled");
    const polls = stub.linkPolls(view.userCode);
    stub.approveLink(view.userCode);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(stub.linkPolls(view.userCode)).toBe(polls);
    expect((await status(host)).state).toBe("signed-out");
  });

  it("keeps a newer code sign-in when an older link sign-in finishes after it", async () => {
    const host = await loadAccount();
    const view = (await host.harness.callRpc("login.start", {
      baseUrl: stub.apexUrl,
    })) as LoginView;
    let profileRequests = 0;
    const release = stub.hold(
      "GET",
      "/api/account/me",
      () => profileRequests++ === 0,
    );
    stub.approveLink(view.userCode, { serverId: "srv_2" });
    await vi.waitFor(() =>
      expect(stub.requestsTo("/api/account/me")).toHaveLength(1),
    );
    const staleCredential = mintedLinkCredential();

    stub.issueRedeemCode("NEWR-CODE", { server: { serverId: "srv_3" } });
    await expect(
      host.harness.callRpc("redeemCode", {
        code: "NEWR-CODE",
        baseUrl: stub.apexUrl,
      }),
    ).resolves.toMatchObject({
      state: "signed-in",
      account: { serverId: "srv_3" },
    });
    await waitForLogin(host, view.id, "cancelled");
    release();

    await vi.waitFor(() => expect(stub.isValid(staleCredential)).toBe(false));
    expect(await status(host)).toMatchObject({
      state: "signed-in",
      account: { serverId: "srv_3" },
    });
  });

  it("serializes concurrent starts into one link and one poll loop", async () => {
    const host = await loadAccount();
    const [first, second] = (await Promise.all([
      host.harness.callRpc("login.start", { baseUrl: stub.apexUrl }),
      host.harness.callRpc("login.start", { baseUrl: stub.apexUrl }),
    ])) as [LoginView, LoginView];

    expect(second.id).toBe(first.id);
    expect(stub.requestsTo("/api/account/link/start")).toHaveLength(1);
    await host.harness.callRpc("login.cancel", { loginId: first.id });
  });

  it("stops the replaced poll loop when concurrent starts target different sites", async () => {
    const host = await loadAccount();
    const other = await StubGetbb.start();
    try {
      const [first, second] = (await Promise.all([
        host.harness.callRpc("login.start", { baseUrl: stub.apexUrl }),
        host.harness.callRpc("login.start", { baseUrl: other.apexUrl }),
      ])) as [LoginView, LoginView];
      expect(second.id).not.toBe(first.id);

      await vi.waitFor(() =>
        expect(other.linkPolls(second.userCode)).toBeGreaterThan(0),
      );
      const firstPolls = stub.linkPolls(first.userCode);
      stub.approveLink(first.userCode);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(stub.linkPolls(first.userCode)).toBe(firstPolls);
      expect((await status(host)).state).toBe("signed-out");

      other.approveLink(second.userCode);
      await waitForLogin(host, second.id, "signed-in");
    } finally {
      await other.close();
    }
  });
});

describe("pairings without a profile, and replaced servers", () => {
  it("reports a stored pairing whose account hasn't loaded as profile-pending", async () => {
    const host = await loadAccount();
    stub.route("GET", "/api/account/me", () => ({
      status: 503,
      body: { error: "unavailable" },
    }));
    stub.issueRedeemCode("PEND-CODE");
    const cli = await host.harness.runCli([
      "login",
      "--code",
      "PEND-CODE",
      "--base-url",
      stub.apexUrl,
    ]);
    expect(cli.exitCode).toBe(1);
    expect(cli.stderr).toContain("bb saved the new pairing");

    expect(await status(host)).toMatchObject({
      state: "profile-pending",
      account: null,
    });
    const text = await host.harness.runCli(["status"]);
    expect(text.stdout).toContain("hasn't loaded the account yet");
    expect(text.stdout).not.toContain("Not signed in");

    stub.route("GET", "/api/account/me", (request) => {
      stub.route("GET", "/api/account/me", () => ({ status: 500 }));
      return {
        status: 200,
        body: {
          userId: "usr_1",
          githubLogin: "sawyerhood",
          name: "Sawyer Hood",
          avatarUrl: null,
          handle: "sawyer",
          serverId: "srv_1",
          serverLabel: "sawyer-desktop",
          serverUrl: stub.gateUrl,
          authorization: request.authorization,
        },
      };
    });
    const { controller, done } = host.harness.runService("profile-refresh");
    await vi.waitFor(async () =>
      expect((await status(host)).state).toBe("signed-in"),
    );
    controller.abort();
    await done;
  });

  it("revokes the previous server when signing in to a different one", async () => {
    const host = await loadAccount();
    await signInWithCode(host);
    const first = (
      (await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)) as {
        credential: string;
      }
    ).credential;

    stub.issueRedeemCode("SRV2-CODE", { server: { serverId: "srv_2" } });
    await expect(
      host.harness.callRpc("redeemCode", {
        code: "SRV2-CODE",
        baseUrl: stub.apexUrl,
      }),
    ).resolves.toMatchObject({ account: { serverId: "srv_2" } });

    expect(stub.isValid(first)).toBe(false);
    const second = (
      (await host.bb.storage.kv.get(CREDENTIAL_KV_KEY)) as {
        credential: string;
      }
    ).credential;
    expect(stub.isValid(second)).toBe(true);
  });
});
