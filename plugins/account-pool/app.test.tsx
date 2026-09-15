// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  AccountPoolConfig,
  AccountSummary,
  CacheMissReport,
  PoolStatus,
} from "./src/contracts.js";
import {
  ACCOUNT_POOL_CACHE_MISSES_CHANGED,
  ACCOUNT_POOL_CONFIG_CHANGED,
} from "./src/realtime.js";

const app = await loadPluginApp(() => import("./app"));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const STATUS_CACHE_KEY = "account-pool:status";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function measureAccountRows() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const handle = this.querySelector(
        'button[aria-roledescription="sortable"]',
      );
      const rows = Array.from(this.parentElement?.children ?? []);
      return new DOMRect(0, handle ? rows.indexOf(this) * 60 : 0, 600, 60);
    },
  );
}

async function keyboardMove(handle: HTMLElement, code = "ArrowDown") {
  handle.focus();
  fireEvent.keyDown(handle, { code: "Space" });
  await waitFor(() => expect(handle.getAttribute("aria-pressed")).toBe("true"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireEvent.keyDown(document, { code });
}

function account(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    provider: "claude",
    kind: "oauth",
    label: "person@example.com",
    email: "person@example.com",
    accountUuid: null,
    subscriptionType: "Max",
    rateLimitTier: "default_claude_max_5x",
    enabled: true,
    priority: 100,
    createdAt: 1,
    lastUsedAt: 2,
    lastUsedHostId: "host-one",
    lastUsedHostName: "bee",
    fiveHourUtilization: 0.21,
    fiveHourResetAt: null,
    fiveHourStatus: null,
    sevenDayUtilization: null,
    sevenDayResetAt: null,
    sevenDayStatus: null,
    representativeClaim: null,
    familyWeekly: {
      fable: null,
      sonnet: null,
      opus: null,
      haiku: null,
      other: null,
    },
    limitWindows: [],
    observedAt: 1,
    heldUntil: null,
    error: null,
    inFlight: 0,
    status: "ready",
    ...overrides,
  };
}

function status(accounts: AccountSummary[] = [account()]): PoolStatus {
  return {
    route: "/api/v1/plugins/account-pool/http",
    enabledAccountCount: accounts.filter((item) => item.enabled).length,
    inFlight: 2,
    accepting: true,
    hosts: [
      { hostId: "host-one", hostName: "bee", mintedAt: 1, lastUsedAt: 2 },
    ],
    accounts,
    routing: { claude: true, codex: true },
    parent: null,
  };
}

function config(overrides: Partial<AccountPoolConfig> = {}): AccountPoolConfig {
  return {
    anthropicUpstreamBaseUrl: "https://api.anthropic.com",
    codexUpstreamBaseUrl: "https://chatgpt.com/backend-api/codex",
    switchThreshold: 0.98,
    parentMode: "proxy",
    cacheMissDebug: false,
    cacheMissMinTokens: 10_000,
    ...overrides,
  };
}

function render(
  accounts = [account()],
  extraRpc: Record<string, () => object | null | Promise<object | null>> = {},
) {
  return renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        "status.get": () => status(accounts),
        "config.get": () => config(),
        "cacheMiss.list": () => [],
        ...extraRpc,
      },
      openUrl: () => true,
    },
  );
}

describe("Account Pool parent banner", () => {
  const PARENT_URL = "http://127.0.0.1:25231/api/v1/plugins/account-pool/http";

  function renderWithParent(parent: PoolStatus["parent"]) {
    return renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          "status.get": () => ({ ...status(), parent }),
          "config.get": () => config(),
          "cacheMiss.list": () => [],
        },
        openUrl: () => true,
      },
    );
  }

  it("says nothing about a parent when this server has none", async () => {
    const slot = renderWithParent(null);
    expect(await slot.findByText("person@example.com")).toBeTruthy();
    expect(slot.queryByText(/Account Pooler available/i)).toBeNull();
  });

  it("invites pooling through the parent while isolated, without leaking the api path", async () => {
    const slot = renderWithParent({
      baseUrl: PARENT_URL,
      mode: "isolate",
      availability: { claude: true, codex: true },
    });
    expect(
      await slot.findByText("Parent Account Pooler available"),
    ).toBeTruthy();
    expect(
      slot.getByText(/started from a thread on 127\.0\.0\.1:25231/),
    ).toBeTruthy();
    expect(slot.queryByText(/api\/v1\/plugins/)).toBeNull();
  });

  it("names both providers and says local accounts go unused while proxying", async () => {
    const slot = renderWithParent({
      baseUrl: PARENT_URL,
      mode: "proxy",
      availability: { claude: true, codex: true },
    });
    expect(
      await slot.findByText("Using the parent Account Pooler"),
    ).toBeTruthy();
    expect(
      slot.getByText(
        /Claude and Codex requests are sent to the pool on 127\.0\.0\.1:25231\. Accounts on this server are not used/,
      ),
    ).toBeTruthy();
  });

  it("calls out a provider the parent cannot serve", async () => {
    const slot = renderWithParent({
      baseUrl: PARENT_URL,
      mode: "proxy",
      availability: { claude: true, codex: false },
    });
    expect(
      await slot.findByText(
        /Claude requests are sent to the pool on .*Codex has no accounts there, so those requests fall back/,
      ),
    ).toBeTruthy();
  });

  it("says nothing is routed when the parent has no accounts at all", async () => {
    const slot = renderWithParent({
      baseUrl: PARENT_URL,
      mode: "proxy",
      availability: { claude: false, codex: false },
    });
    expect(
      await slot.findByText(/has no accounts available right now/),
    ).toBeTruthy();
  });

  it("keeps cache miss debugging inside the inert wrapper while proxying", async () => {
    const slot = renderWithParent({
      baseUrl: PARENT_URL,
      mode: "proxy",
      availability: { claude: true, codex: true },
    });
    const trigger = await slot.findByRole("button", {
      name: "Cache miss debugging",
    });
    expect(trigger.closest("[inert]")).not.toBeNull();
  });
});

describe("Account Pool settings", () => {
  it("renders cached accounts as refreshing until live status arrives, then caches it", async () => {
    window.localStorage.setItem(
      STATUS_CACHE_KEY,
      JSON.stringify(status([account({ fiveHourUtilization: 0.21 })])),
    );
    const live = deferred<PoolStatus>();
    const slot = render([], { "status.get": () => live.promise });
    expect(slot.getByText("person@example.com")).toBeTruthy();
    expect(slot.getByText("21%")).toBeTruthy();
    expect(slot.getByText("refreshing usage…")).toBeTruthy();
    expect(slot.getByText(/· refreshing…$/)).toBeTruthy();
    expect(slot.queryByText("Loading…")).toBeNull();
    expect(slot.queryByText("No accounts in the pool")).toBeNull();
    live.resolve(status([account({ fiveHourUtilization: 0.6 })]));
    expect(await slot.findByText("60%")).toBeTruthy();
    expect(slot.queryByText("refreshing usage…")).toBeNull();
    expect(slot.queryByText(/· refreshing…$/)).toBeNull();
    const cached = JSON.parse(
      window.localStorage.getItem(STATUS_CACHE_KEY) ?? "null",
    ) as PoolStatus;
    expect(cached.accounts[0]?.fiveHourUtilization).toBe(0.6);
  });

  it("ignores a malformed status cache and shows the loading state", async () => {
    window.localStorage.setItem(STATUS_CACHE_KEY, '{"accounts":"nope"}');
    const live = deferred<PoolStatus>();
    const slot = render([], { "status.get": () => live.promise });
    expect(slot.getAllByText("Loading…")).toHaveLength(2);
    live.resolve(status());
    expect(await slot.findByText("person@example.com")).toBeTruthy();
  });

  it("marks a row as refreshing while its usage refresh is in flight", async () => {
    const refresh = deferred<{ account: null }>();
    const slot = render([account()], {
      "account.refreshUsage": () => refresh.promise,
    });
    fireEvent.pointerDown(
      await slot.findByRole("button", { name: "person@example.com actions" }),
    );
    fireEvent.click(await slot.findByText("Refresh usage"));
    expect(await slot.findByText("refreshing usage…")).toBeTruthy();
    refresh.resolve({ account: null });
    await waitFor(() =>
      expect(slot.queryByText("refreshing usage…")).toBeNull(),
    );
  });

  it("renders fixed quota slots with missing buckets as em dashes", async () => {
    const slot = render();
    expect(await slot.findByText("person@example.com")).toBeTruthy();
    expect(slot.getByText("5H")).toBeTruthy();
    expect(slot.getByText("7D")).toBeTruthy();
    expect(slot.getByText("FABLE")).toBeTruthy();
    expect(slot.getAllByText("—")).toHaveLength(2);
    expect(
      slot.getByText("Hub accepting · 2 in flight · used by bee"),
    ).toBeTruthy();
  });

  it("keeps the quota slots visible at mobile widths", async () => {
    const slot = render();
    const group = (await slot.findByText("5H")).parentElement?.parentElement;
    expect(group).toBeTruthy();
    expect(group?.className).not.toMatch(/(^|\s)hidden(\s|$)/u);
  });

  it("renders only the windows a Codex account reports and no Fable slot", async () => {
    const blockingResetAt = Date.now() + 6 * 24 * 60 * 60 * 1_000;
    const slot = render([
      account({
        id: "22222222-2222-4222-8222-222222222222",
        provider: "codex",
        label: "pro@example.com",
        codexAccountId: "chatgpt-account",
        status: "exhausted",
        fiveHourUtilization: 0.25,
        fiveHourResetAt: Date.now() + 60 * 60 * 1_000,
        limitWindows: [
          {
            slot: "primary",
            windowMinutes: 10_080,
            utilization: 1,
            resetAt: blockingResetAt,
            status: "rejected",
            observedAt: 1,
            source: "usage",
          },
        ],
      }),
    ]);
    expect(await slot.findByText("pro@example.com")).toBeTruthy();
    expect(slot.getByText("7D")).toBeTruthy();
    expect(slot.getByText("100%")).toBeTruthy();
    expect(slot.queryByText("5H")).toBeNull();
    expect(slot.queryByText("FABLE")).toBeNull();
    expect(
      slot.getByText(
        `Exhausted · resets ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(blockingResetAt)}`,
      ),
    ).toBeTruthy();
    fireEvent.click(
      await slot.findByRole("button", { name: "Open pro@example.com details" }),
    );
    expect(await slot.findByText("Weekly")).toBeTruthy();
    expect(slot.queryByText("5 hour")).toBeNull();
    expect(slot.queryByText("7 day")).toBeNull();
  });

  it.each([
    {
      action: "Disable",
      method: "account.disable",
      input: { id: account().id },
    },
    {
      action: "Refresh usage",
      method: "account.refreshUsage",
      input: { accountId: account().id },
    },
  ])(
    "dispatches $action to its RPC contract",
    async ({ action, method, input }) => {
      const slot = render([account()], {
        [method]: () => ({ account: null }),
      });
      fireEvent.pointerDown(
        await slot.findByRole("button", { name: "person@example.com actions" }),
      );
      fireEvent.click(await slot.findByText(action));
      expect(slot.rpcCalls).toContainEqual({ method, input });
    },
  );

  it("confirms Remove before dispatching its RPC contract", async () => {
    const slot = render([account()], {
      "account.remove": () => ({ removed: true }),
    });
    fireEvent.pointerDown(
      await slot.findByRole("button", { name: "person@example.com actions" }),
    );
    fireEvent.click(await slot.findByText("Remove"));
    expect(await slot.findByText("Remove person@example.com?")).toBeTruthy();
    expect(slot.rpcCalls.some((call) => call.method === "account.remove")).toBe(
      false,
    );
    fireEvent.click(slot.getByRole("button", { name: "Remove" }));
    expect(slot.rpcCalls).toContainEqual({
      method: "account.remove",
      input: { id: account().id },
    });
  });

  it("opens the correct provider sign-in flow from each Add account menu", async () => {
    const slot = render([], {
      "login.start": () => ({
        sessionId: "22222222-2222-4222-8222-222222222222",
        authorizeUrl: "https://claude.ai/oauth/authorize",
      }),
      "codexLogin.start": () => ({
        sessionId: "33333333-3333-4333-8333-333333333333",
        verificationUri: "https://auth.openai.com/codex/device",
        userCode: "ABCD-1234",
        expiresAt: Date.now() + 600_000,
        intervalMs: 60_000,
      }),
    });
    const addButtons = await slot.findAllByRole("button", {
      name: "Add account",
    });
    fireEvent.pointerDown(addButtons[0]!);
    fireEvent.click(
      await slot.findByText("Sign in to Claude", { selector: "span.block" }),
    );
    expect(
      await slot.findByLabelText("Claude authorization code"),
    ).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Close" }));
    fireEvent.pointerDown(addButtons[1]!);
    fireEvent.click(
      await slot.findByText("Sign in to Codex", { selector: "span.block" }),
    );
    expect(
      (await slot.findByLabelText("Codex user code")).textContent,
    ).toContain("ABCD-1234");
  });

  it("persists provider routing from the section switch", async () => {
    const slot = render([account()], {
      "routing.set": () => ({ provider: "claude", enabled: false }),
    });
    fireEvent.click(
      await slot.findByRole("switch", { name: "Route Claude threads" }),
    );
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "routing.set",
        input: { provider: "claude", enabled: false },
      }),
    );
  });

  it("edits Advanced config fields and shows URL validation inline", async () => {
    const nextConfig = config({
      anthropicUpstreamBaseUrl: "https://proxy.example.com",
    });
    const slot = render([account()], {
      "config.set": () => nextConfig,
    });
    fireEvent.click(await slot.findByRole("button", { name: "Advanced" }));
    const anthropic = await slot.findByLabelText("Anthropic upstream base URL");
    if (!(anthropic instanceof HTMLInputElement)) {
      throw new Error("Expected the Anthropic config field to be an input.");
    }
    await waitFor(() =>
      expect(anthropic.value).toBe("https://api.anthropic.com"),
    );
    expect(slot.getByLabelText("Codex upstream base URL")).toBeTruthy();
    expect(slot.getByLabelText("Quota switch threshold")).toBeTruthy();

    fireEvent.change(anthropic, { target: { value: "ftp://invalid.example" } });
    fireEvent.blur(anthropic);
    expect(await slot.findByText("Must be an HTTP or HTTPS URL.")).toBeTruthy();
    expect(slot.rpcCalls.some((call) => call.method === "config.set")).toBe(
      false,
    );

    fireEvent.change(anthropic, {
      target: { value: "https://proxy.example.com" },
    });
    fireEvent.blur(anthropic);
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "config.set",
        input: { anthropicUpstreamBaseUrl: "https://proxy.example.com" },
      }),
    );
  });

  it("shows every observed family bucket in the detail dialog", async () => {
    const fable = {
      utilization: 0.91,
      resetAt: Date.now() + 3_600_000,
      status: null,
      observedAt: 1,
      source: "usage" as const,
    };
    const slot = render([
      account({
        familyWeekly: {
          fable,
          sonnet: null,
          opus: { ...fable, utilization: 0.2 },
          haiku: null,
          other: null,
        },
      }),
    ]);
    fireEvent.click(
      await slot.findByRole("button", {
        name: "Open person@example.com details",
      }),
    );
    expect(await slot.findByText("Fable 7 day")).toBeTruthy();
    expect(slot.getByText("Opus 7 day")).toBeTruthy();
  });

  it("shows the email beside a display-name label in the row and detail dialog", async () => {
    const slot = render([
      account({ label: "Person Example", email: "person@example.com" }),
      account({
        id: "22222222-2222-4222-8222-222222222222",
        label: "Claude API key",
        email: null,
      }),
    ]);
    expect(await slot.findByText("Person Example")).toBeTruthy();
    expect(slot.getAllByText("person@example.com")).toHaveLength(1);
    fireEvent.click(
      slot.getByRole("button", { name: "Open Person Example details" }),
    );
    expect(await slot.findByText("Email")).toBeTruthy();
    expect(slot.getAllByText("person@example.com")).toHaveLength(2);
  });

  function codexLoginStart() {
    return {
      sessionId: "33333333-3333-4333-8333-333333333333",
      verificationUri: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234",
      expiresAt: Date.now() + 600_000,
      intervalMs: 60_000,
    };
  }

  function mockCompactViewport(matches: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 767px)" && matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
  }

  it("names the sign-in dialog once and keeps the step instructions", async () => {
    const slot = render([], { "codexLogin.start": codexLoginStart });
    fireEvent.click(
      await slot.findByRole("button", { name: "Sign in to Codex" }),
    );
    const dialog = await slot.findByRole("dialog", {
      name: "Sign in to Codex",
    });
    expect(
      slot.getAllByRole("heading", { name: "Sign in to Codex" }),
    ).toHaveLength(1);
    expect(dialog.textContent).toContain(
      "Open the verification page, sign in to ChatGPT, and enter this code.",
    );
    expect(
      (await slot.findByLabelText("Codex user code")).textContent,
    ).toContain("ABCD-1234");
    expect(slot.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it.each([false, true])(
    "cancels the pending sign-in from the header close with compact viewport %s",
    async (compact) => {
      mockCompactViewport(compact);
      const slot = render([], {
        "codexLogin.start": codexLoginStart,
        "codexLogin.poll": () => ({ status: "pending" }),
        "codexLogin.cancel": () => ({ cancelled: true }),
      });
      fireEvent.click(
        await slot.findByRole("button", { name: "Sign in to Codex" }),
      );
      await slot.findByRole("dialog", { name: "Sign in to Codex" });
      fireEvent.click(slot.getByRole("button", { name: "Close" }));
      await waitFor(() =>
        expect(slot.rpcCalls).toContainEqual({
          method: "codexLogin.cancel",
          input: { sessionId: codexLoginStart().sessionId },
        }),
      );
      await waitFor(() =>
        expect(slot.queryByRole("dialog", { name: "Sign in to Codex" })).toBe(
          null,
        ),
      );
      const polls = () =>
        slot.rpcCalls.filter((call) => call.method === "codexLogin.poll")
          .length;
      const settled = polls();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(polls()).toBe(settled);
    },
  );

  it("copies the exact device code and distinguishes it from the URL copy", async () => {
    const codeCopy = deferred<void>();
    const urlCopy = deferred<void>();
    const writeText = vi
      .fn()
      .mockImplementationOnce(() => codeCopy.promise)
      .mockImplementationOnce(() => urlCopy.promise);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    const slot = render([], { "codexLogin.start": codexLoginStart });
    fireEvent.click(
      await slot.findByRole("button", { name: "Sign in to Codex" }),
    );
    fireEvent.click(
      await slot.findByRole("button", { name: "Copy Codex sign-in code" }),
    );
    expect(writeText).toHaveBeenLastCalledWith("ABCD-1234");
    await act(async () => codeCopy.resolve());
    expect(slot.getByText("Sign-in code copied")).toBeTruthy();
    expect(
      slot
        .getByRole("button", { name: "Copy Codex sign-in code" })
        .querySelector('[data-icon="Check"]'),
    ).not.toBeNull();

    const urlButton = slot.getByRole("button", {
      name: "Copy Codex authorization URL",
    });
    fireEvent.click(urlButton);
    expect(writeText).toHaveBeenLastCalledWith(
      "https://auth.openai.com/codex/device",
    );
    await act(async () => urlCopy.resolve());
    expect(slot.getByText("Authorization URL copied")).toBeTruthy();
    expect(urlButton.textContent).toContain("Copied");
  });

  it("does not claim success when copying the device code fails", async () => {
    const copy = deferred<void>();
    const writeText = vi.fn(() => copy.promise);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    const slot = render([], { "codexLogin.start": codexLoginStart });
    fireEvent.click(
      await slot.findByRole("button", { name: "Sign in to Codex" }),
    );
    const button = await slot.findByRole("button", {
      name: "Copy Codex sign-in code",
    });
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith("ABCD-1234");
    await act(async () => copy.reject(new Error("denied")));
    expect(window.getSelection()?.toString()).toBe("ABCD-1234");
    expect(slot.queryByText("Sign-in code copied")).toBeNull();
    expect(button.querySelector('[data-icon="Check"]')).toBeNull();
  });

  it("does not claim success when copying the authorization URL fails", async () => {
    const copy = deferred<void>();
    const writeText = vi.fn(() => copy.promise);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    const slot = render([], { "codexLogin.start": codexLoginStart });
    fireEvent.click(
      await slot.findByRole("button", { name: "Sign in to Codex" }),
    );
    const button = await slot.findByRole("button", {
      name: "Copy Codex authorization URL",
    });
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith(
      "https://auth.openai.com/codex/device",
    );
    await act(async () => copy.reject(new Error("denied")));
    const input = slot.getByRole("textbox", {
      name: "Codex authorization URL",
    }) as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(button.textContent).not.toContain("Copied");
    expect(slot.queryByText("Authorization URL copied")).toBeNull();
  });

  it("keeps polling and the close action working after copying the code", async () => {
    const copy = deferred<void>();
    const writeText = vi.fn(() => copy.promise);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    const slot = render([], {
      "codexLogin.start": codexLoginStart,
      "codexLogin.poll": () => ({ status: "pending" }),
      "codexLogin.cancel": () => ({ cancelled: true }),
    });
    fireEvent.click(
      await slot.findByRole("button", { name: "Sign in to Codex" }),
    );
    fireEvent.click(
      await slot.findByRole("button", { name: "Copy Codex sign-in code" }),
    );
    expect(writeText).toHaveBeenCalledWith("ABCD-1234");
    await act(async () => copy.resolve());
    expect(
      (await slot.findByRole("dialog", { name: "Sign in to Codex" }))
        .textContent,
    ).toContain("Waiting for you to authorize");
    fireEvent.click(slot.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "codexLogin.cancel",
        input: { sessionId: codexLoginStart().sessionId },
      }),
    );
  });

  it("offers a fresh Codex login after device-code polling fails", async () => {
    let starts = 0;
    const slot = render([], {
      "codexLogin.start": () => {
        starts += 1;
        return {
          sessionId: "33333333-3333-4333-8333-333333333333",
          verificationUri: "https://auth.openai.com/codex/device",
          userCode: "ABCD-1234",
          expiresAt: Date.now() + 600_000,
          intervalMs: 1,
        };
      },
      "codexLogin.poll": () => ({ status: "error", message: "Code expired." }),
    });
    fireEvent.click(
      await slot.findByRole("button", { name: "Sign in to Codex" }),
    );
    fireEvent.click(await slot.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(starts).toBe(2));
  });
  it.each(["claude", "codex"] as const)(
    "reorders %s accounts with the keyboard and persists the displayed order",
    async (provider) => {
      measureAccountRows();
      const first = account({ label: "First", provider });
      const second = account({
        id: "22222222-2222-4222-8222-222222222222",
        label: "Second",
        provider,
      });
      const other = account({
        id: "33333333-3333-4333-8333-333333333333",
        provider: provider === "claude" ? "codex" : "claude",
        label: "Other",
      });
      const accounts = [first, second, other];
      let finishSave = () => {};
      const slot = render(accounts, {
        "account.reorder": () =>
          new Promise<null>((resolve) => {
            finishSave = () => {
              accounts.splice(0, 2, second, first);
              resolve(null);
            };
          }),
      });
      const handle = await slot.findByRole("button", { name: "Reorder First" });
      await keyboardMove(handle);
      fireEvent.keyDown(document, { code: "Space" });
      await waitFor(() =>
        expect(slot.rpcCalls).toContainEqual({
          method: "account.reorder",
          input: { provider, accountIds: [second.id, first.id] },
        }),
      );
      const providerOrder = () =>
        slot
          .getAllByRole("button", { name: /Reorder (First|Second)/ })
          .map((button) => button.getAttribute("aria-label"));
      expect(providerOrder()).toEqual(["Reorder Second", "Reorder First"]);
      expect(handle.hasAttribute("disabled")).toBe(true);
      finishSave();
      await waitFor(() => expect(handle.hasAttribute("disabled")).toBe(false));
      expect(providerOrder()).toEqual(["Reorder Second", "Reorder First"]);
      expect(
        slot
          .getByRole("button", { name: "Reorder Other" })
          .hasAttribute("disabled"),
      ).toBe(true);
    },
  );

  it("restores the displayed order and reports a rejected reorder", async () => {
    measureAccountRows();
    const slot = render(
      [
        account({ label: "First" }),
        account({
          id: "22222222-2222-4222-8222-222222222222",
          label: "Second",
        }),
      ],
      {
        "account.reorder": () => {
          throw new Error("Refresh the account list and try again.");
        },
      },
    );
    const handle = await slot.findByRole("button", { name: "Reorder First" });
    await keyboardMove(handle);
    fireEvent.keyDown(document, { code: "Space" });
    expect(
      await slot.findByText("Refresh the account list and try again."),
    ).toBeTruthy();
    expect(
      slot
        .getAllByRole("button", { name: /Reorder/ })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Reorder First", "Reorder Second"]);
    expect(handle.hasAttribute("disabled")).toBe(false);
  });

  it.each(["cancel", "unchanged"])(
    "does not save a %s drag",
    async (action) => {
      measureAccountRows();
      const slot = render([
        account({ label: "First" }),
        account({
          id: "22222222-2222-4222-8222-222222222222",
          label: "Second",
        }),
      ]);
      const handle = await slot.findByRole("button", { name: "Reorder First" });
      await keyboardMove(handle, action === "cancel" ? "ArrowDown" : "ArrowUp");
      fireEvent.keyDown(document, {
        code: action === "cancel" ? "Escape" : "Space",
      });
      await waitFor(() =>
        expect(handle.getAttribute("aria-pressed")).toBeNull(),
      );
      expect(
        slot.rpcCalls.filter((call) => call.method === "account.reorder"),
      ).toEqual([]);
      expect(
        slot
          .getAllByRole("button", { name: /Reorder/ })
          .map((button) => button.getAttribute("aria-label")),
      ).toEqual(["Reorder First", "Reorder Second"]);
    },
  );
});

describe("Account Pool cache miss debugging", () => {
  const BEFORE =
    '{"name":"lookup_weather","description":"Daily forecast for a city"}';
  const AFTER =
    '{"name":"lookup_weather","description":"Hourly forecast for a city"}';
  const ENABLED_EMPTY = "No large cache misses observed yet.";
  const DISABLED_EMPTY =
    "No cache miss reports. Turn on reporting above to record large prompt cache misses.";
  const tokens = new Intl.NumberFormat();

  function cacheMissReport(
    overrides: Partial<CacheMissReport> = {},
  ): CacheMissReport {
    return {
      id: "44444444-4444-4444-8444-444444444444",
      observedAt: Date.now() - 5 * 60_000,
      provider: "claude",
      model: "claude-fable-5",
      sessionId: "5f0c2a9e-7d1b-4c3e-9a8f-1b2c3d4e5f60",
      hostId: "host-one",
      hostName: "bee",
      accountId: account().id,
      accountLabel: "person@example.com",
      previous: {
        observedAt: Date.now() - 6 * 60_000,
        accountId: "22222222-2222-4222-8222-222222222222",
        accountLabel: "backup@example.com",
        model: "claude-fable-5",
        usage: {
          promptTokens: 52_000,
          cacheReadTokens: 40_000,
          cacheWriteTokens: 10_000,
        },
      },
      usage: {
        promptTokens: 53_000,
        cacheReadTokens: 8_000,
        cacheWriteTokens: 45_000,
      },
      expectedCachedTokens: 50_000,
      missedTokens: 42_000,
      causes: [
        {
          kind: "account-switch",
          message:
            "The previous request used backup@example.com. Prompt caches are isolated per organization.",
        },
        {
          kind: "prompt-change",
          message:
            "tools[1] (tool lookup_weather) was modified, which invalidates the whole cache.",
        },
      ],
      divergence: {
        level: "tools",
        path: "tools[1]",
        label: "tool lookup_weather",
        change: "modified",
        offset: 42,
        before: BEFORE,
        after: AFTER,
        keyOrderOnly: false,
        sharedSegments: 1,
        previousSegments: 6,
        currentSegments: 6,
      },
      ...overrides,
    };
  }

  async function openCacheMissSection(slot: ReturnType<typeof render>) {
    fireEvent.click(
      await slot.findByRole("button", { name: /^Cache miss debugging/ }),
    );
  }

  it.each([false, true])(
    "shows cacheMissDebug %s in the switch and saves the flipped value",
    async (enabled) => {
      const slot = render([account()], {
        "config.get": () => config({ cacheMissDebug: enabled }),
        "config.set": () => config({ cacheMissDebug: !enabled }),
      });
      await openCacheMissSection(slot);
      const toggle = await slot.findByRole("switch", {
        name: "Report large prompt cache misses",
      });
      await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
      expect(toggle.getAttribute("aria-checked")).toBe(String(enabled));
      expect(
        await slot.findByText(enabled ? ENABLED_EMPTY : DISABLED_EMPTY),
      ).toBeTruthy();

      fireEvent.click(toggle);
      await waitFor(() =>
        expect(slot.rpcCalls).toContainEqual({
          method: "config.set",
          input: { cacheMissDebug: !enabled },
        }),
      );
      await waitFor(() =>
        expect(toggle.getAttribute("aria-checked")).toBe(String(!enabled)),
      );
      expect(
        await slot.findByText(enabled ? DISABLED_EMPTY : ENABLED_EMPTY),
      ).toBeTruthy();
    },
  );

  it("validates the minimum missed tokens inline and saves a whole number on Enter", async () => {
    const slot = render([account()], {
      "config.set": () => config({ cacheMissMinTokens: 25_000 }),
    });
    await openCacheMissSection(slot);
    const field = await slot.findByLabelText("Minimum missed tokens");
    if (!(field instanceof HTMLInputElement)) {
      throw new Error(
        "Expected the minimum missed tokens field to be an input.",
      );
    }
    await waitFor(() => expect(field.value).toBe("10000"));

    for (const invalid of ["0", "1.5", "-3"]) {
      fireEvent.change(field, { target: { value: invalid } });
      expect(
        slot.queryByText("Must be a whole number greater than 0."),
      ).toBeNull();
      fireEvent.blur(field);
      expect(
        await slot.findByText("Must be a whole number greater than 0."),
      ).toBeTruthy();
    }
    expect(slot.rpcCalls.some((call) => call.method === "config.set")).toBe(
      false,
    );

    fireEvent.change(field, { target: { value: "25000" } });
    field.focus();
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "config.set",
        input: { cacheMissMinTokens: 25_000 },
      }),
    );
    await waitFor(() => expect(field.value).toBe("25000"));
    expect(
      slot.queryByText("Must be a whole number greater than 0."),
    ).toBeNull();
  });

  it("lists reports with causes, the divergent segment, and before and after excerpts", async () => {
    const claude = cacheMissReport();
    const codex = cacheMissReport({
      id: "55555555-5555-4555-8555-555555555555",
      provider: "codex",
      model: null,
      sessionId: "thread-7",
      hostId: "host-two",
      hostName: null,
      previous: {
        ...claude.previous,
        accountId: account().id,
        accountLabel: "person@example.com",
        model: null,
      },
      causes: [
        {
          kind: "unexplained",
          message:
            "The prefix, account, model, and parameters were unchanged within the cache lifetime.",
        },
      ],
      divergence: null,
    });
    const slot = render([account()], {
      "config.get": () => config({ cacheMissDebug: true }),
      "cacheMiss.list": () => [claude, codex],
    });
    fireEvent.click(
      await slot.findByRole("button", {
        name: "Cache miss debugging 2 reports",
      }),
    );
    const list = await slot.findByRole("list", { name: "Cache miss reports" });
    const rows = Array.from(list.children).filter(
      (child): child is HTMLLIElement => child instanceof HTMLLIElement,
    );
    expect(rows).toHaveLength(2);

    const claudeRow = within(rows[0]!);
    expect(claudeRow.getByText("Claude")).toBeTruthy();
    expect(claudeRow.getByText("claude-fable-5")).toBeTruthy();
    expect(claudeRow.getByText("5 min ago")).toBeTruthy();
    expect(
      claudeRow.getByText(
        `${tokens.format(42_000)} of ${tokens.format(50_000)} cached tokens missed`,
      ),
    ).toBeTruthy();
    expect(
      claudeRow.getByText(
        "Account person@example.com, previously backup@example.com",
      ),
    ).toBeTruthy();
    expect(claudeRow.getByText("5f0c2a9e…").parentElement?.title).toBe(
      claude.sessionId,
    );
    expect(claudeRow.getByText("Host bee")).toBeTruthy();
    expect(claudeRow.getByText("Account switch")).toBeTruthy();
    expect(claudeRow.getByText(claude.causes[0]!.message)).toBeTruthy();
    expect(claudeRow.getByText("Prompt change")).toBeTruthy();
    expect(claudeRow.getByText(claude.causes[1]!.message)).toBeTruthy();
    expect(claudeRow.getByText("tools[1]")).toBeTruthy();
    expect(claudeRow.getByText("tool lookup_weather")).toBeTruthy();
    expect(claudeRow.getByText("modified")).toBeTruthy();
    expect(claudeRow.queryByText("key order only")).toBeNull();
    const excerpt = (label: string) =>
      claudeRow.getByText(label).parentElement?.querySelector("pre");
    expect(excerpt("Before")?.textContent).toBe(BEFORE);
    expect(excerpt("After")?.textContent).toBe(AFTER);

    const codexRow = within(rows[1]!);
    expect(codexRow.getByText("Codex")).toBeTruthy();
    expect(codexRow.queryByText("claude-fable-5")).toBeNull();
    expect(codexRow.getByText("Account person@example.com")).toBeTruthy();
    expect(codexRow.getByText("thread-7")).toBeTruthy();
    expect(codexRow.getByText("Host host-two")).toBeTruthy();
    expect(codexRow.getByText("Unexplained")).toBeTruthy();
    expect(codexRow.queryByText("Before")).toBeNull();
    expect(codexRow.queryByText("After")).toBeNull();
  });

  it("shows only the side of the excerpt that exists and flags key-order-only changes", async () => {
    const report = cacheMissReport();
    const slot = render([account()], {
      "cacheMiss.list": () => [
        cacheMissReport({
          divergence: {
            ...report.divergence!,
            change: "inserted",
            before: null,
            keyOrderOnly: true,
          },
        }),
      ],
    });
    await openCacheMissSection(slot);
    const list = await slot.findByRole("list", { name: "Cache miss reports" });
    expect(within(list).getByText("inserted")).toBeTruthy();
    expect(within(list).getByText("key order only")).toBeTruthy();
    expect(within(list).queryByText("Before")).toBeNull();
    expect(within(list).queryByText(BEFORE)).toBeNull();
    const after = within(list).getByText(AFTER);
    expect(after.tagName).toBe("PRE");
    expect(after.querySelector("mark")).toBeNull();
  });

  it("clears reports through cacheMiss.clear and shows the empty state", async () => {
    let reports = [cacheMissReport()];
    const slot = render([account()], {
      "config.get": () => config({ cacheMissDebug: true }),
      "cacheMiss.list": () => reports,
      "cacheMiss.clear": () => {
        const cleared = reports.length;
        reports = [];
        return { cleared };
      },
    });
    await openCacheMissSection(slot);
    expect(
      await slot.findByRole("list", { name: "Cache miss reports" }),
    ).toBeTruthy();
    const clear = slot.getByRole("button", {
      name: "Clear cache miss reports",
    });
    await waitFor(() => expect(clear.hasAttribute("disabled")).toBe(false));
    fireEvent.click(clear);
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "cacheMiss.clear",
        input: null,
      }),
    );
    expect(await slot.findByText(ENABLED_EMPTY)).toBeTruthy();
    expect(slot.queryByRole("list", { name: "Cache miss reports" })).toBeNull();
    expect(clear.hasAttribute("disabled")).toBe(true);
  });

  it("reloads reports when the cache-misses-changed realtime event arrives", async () => {
    let reports: CacheMissReport[] = [];
    const slot = render([account()], {
      "config.get": () => config({ cacheMissDebug: true }),
      "cacheMiss.list": () => reports,
    });
    await openCacheMissSection(slot);
    expect(await slot.findByText(ENABLED_EMPTY)).toBeTruthy();
    reports = [cacheMissReport()];
    await slot.emitRealtime(ACCOUNT_POOL_CACHE_MISSES_CHANGED, {});
    expect(
      await slot.findByRole("list", { name: "Cache miss reports" }),
    ).toBeTruthy();
    expect(slot.queryByText(ENABLED_EMPTY)).toBeNull();
  });

  it("keeps the newest report list when refreshes resolve out of order", async () => {
    const lists: Array<ReturnType<typeof deferred<CacheMissReport[]>>> = [];
    const slot = render([account()], {
      "config.get": () => config({ cacheMissDebug: true }),
      "cacheMiss.list": () => {
        const next = deferred<CacheMissReport[]>();
        lists.push(next);
        return next.promise;
      },
    });
    await openCacheMissSection(slot);
    await waitFor(() => expect(lists).toHaveLength(1));
    lists[0]!.resolve([]);
    expect(await slot.findByText(ENABLED_EMPTY)).toBeTruthy();

    await slot.emitRealtime(ACCOUNT_POOL_CACHE_MISSES_CHANGED, {});
    await slot.emitRealtime(ACCOUNT_POOL_CACHE_MISSES_CHANGED, {});
    expect(lists).toHaveLength(3);
    lists[2]!.resolve([
      cacheMissReport({
        id: "77777777-7777-4777-8777-777777777777",
        sessionId: "session-new",
      }),
    ]);
    expect(await slot.findByText("session-new")).toBeTruthy();
    await act(async () => {
      lists[1]!.resolve([
        cacheMissReport({
          id: "66666666-6666-4666-8666-666666666666",
          sessionId: "session-old",
        }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(slot.queryByText("session-old")).toBeNull();
    expect(slot.getByText("session-new")).toBeTruthy();
  });

  it("keeps an invalid unsaved draft with its error when the reporting switch reloads config", async () => {
    const slot = render([account()], {
      "config.set": () => config({ cacheMissDebug: true }),
    });
    await openCacheMissSection(slot);
    const field = await slot.findByLabelText("Minimum missed tokens");
    if (!(field instanceof HTMLInputElement)) {
      throw new Error(
        "Expected the minimum missed tokens field to be an input.",
      );
    }
    await waitFor(() => expect(field.value).toBe("10000"));
    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.blur(field);
    expect(
      await slot.findByText("Must be a whole number greater than 0."),
    ).toBeTruthy();
    const toggle = await slot.findByRole("switch", {
      name: "Report large prompt cache misses",
    });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("true"),
    );
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
    expect(field.value).toBe("0");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(
      slot.getByText("Must be a whole number greater than 0."),
    ).toBeTruthy();
    fireEvent.change(field, { target: { value: "10000" } });
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(
      slot.queryByText("Must be a whole number greater than 0."),
    ).toBeNull();
  });

  it("keeps an unsaved minimum missed tokens edit when config changes elsewhere", async () => {
    let current = config();
    const slot = render([account()], {
      "config.get": () => current,
      "config.set": () =>
        config({
          cacheMissDebug: true,
          switchThreshold: 0.9,
          cacheMissMinTokens: 25_000,
        }),
    });
    await openCacheMissSection(slot);
    const field = await slot.findByLabelText("Minimum missed tokens");
    if (!(field instanceof HTMLInputElement)) {
      throw new Error(
        "Expected the minimum missed tokens field to be an input.",
      );
    }
    await waitFor(() => expect(field.value).toBe("10000"));
    fireEvent.change(field, { target: { value: "25000" } });
    current = config({ cacheMissDebug: true, switchThreshold: 0.9 });
    await slot.emitRealtime(ACCOUNT_POOL_CONFIG_CHANGED, {});
    const toggle = await slot.findByRole("switch", {
      name: "Report large prompt cache misses",
    });
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("true"),
    );
    expect(field.value).toBe("25000");
    fireEvent.click(await slot.findByRole("button", { name: /^Advanced/ }));
    const threshold = await slot.findByLabelText("Quota switch threshold");
    if (!(threshold instanceof HTMLInputElement)) {
      throw new Error("Expected the threshold field to be an input.");
    }
    expect(threshold.value).toBe("0.9");
    fireEvent.blur(field);
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "config.set",
        input: { cacheMissMinTokens: 25_000 },
      }),
    );
    await waitFor(() => expect(field.value).toBe("25000"));
  });

  it("ignores a failure from a superseded report refresh", async () => {
    const lists: Array<{
      resolve: (reports: CacheMissReport[]) => void;
      reject: (error: Error) => void;
    }> = [];
    const slot = render([account()], {
      "config.get": () => config({ cacheMissDebug: true }),
      "cacheMiss.list": () =>
        new Promise<CacheMissReport[]>((resolve, reject) => {
          lists.push({ resolve, reject });
        }),
    });
    await openCacheMissSection(slot);
    await waitFor(() => expect(lists).toHaveLength(1));
    lists[0]!.resolve([]);
    expect(await slot.findByText(ENABLED_EMPTY)).toBeTruthy();
    await slot.emitRealtime(ACCOUNT_POOL_CACHE_MISSES_CHANGED, {});
    await slot.emitRealtime(ACCOUNT_POOL_CACHE_MISSES_CHANGED, {});
    expect(lists).toHaveLength(3);
    lists[2]!.resolve([
      cacheMissReport({
        id: "77777777-7777-4777-8777-777777777777",
        sessionId: "session-new",
      }),
    ]);
    expect(await slot.findByText("session-new")).toBeTruthy();
    await act(async () => {
      lists[1]!.reject(new Error("Superseded refresh failed."));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(slot.queryByText("Superseded refresh failed.")).toBeNull();
    expect(slot.getByText("session-new")).toBeTruthy();
  });

  it("shows a report loading failure in the section and retries it", async () => {
    let failing = true;
    const slot = render([account()], {
      "config.get": () => config({ cacheMissDebug: true }),
      "cacheMiss.list": () => {
        if (failing) throw new Error("Could not load reports.");
        return [cacheMissReport()];
      },
    });
    await openCacheMissSection(slot);
    expect(await slot.findByText("Could not load reports.")).toBeTruthy();
    expect(slot.queryByText("Loading…")).toBeNull();
    failing = false;
    fireEvent.click(
      slot.getByRole("button", { name: "Retry loading cache miss reports" }),
    );
    expect(
      await slot.findByRole("list", { name: "Cache miss reports" }),
    ).toBeTruthy();
    expect(slot.queryByText("Could not load reports.")).toBeNull();
    expect(
      slot.rpcCalls.filter((call) => call.method === "cacheMiss.list"),
    ).toHaveLength(2);
  });

  it("shows the retry in progress and announces a repeated failure again", async () => {
    const lists: Array<{
      resolve: (reports: CacheMissReport[]) => void;
      reject: (error: Error) => void;
    }> = [];
    const slot = render([account()], {
      "config.get": () => config({ cacheMissDebug: true }),
      "cacheMiss.list": () =>
        new Promise<CacheMissReport[]>((resolve, reject) => {
          lists.push({ resolve, reject });
        }),
    });
    await openCacheMissSection(slot);
    await waitFor(() => expect(lists).toHaveLength(1));
    await act(async () => {
      lists[0]!.reject(new Error("Could not load reports."));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const firstAlert = await slot.findByText("Could not load reports.");
    fireEvent.click(
      slot.getByRole("button", { name: "Retry loading cache miss reports" }),
    );
    await waitFor(() => expect(lists).toHaveLength(2));
    expect(slot.queryByText("Could not load reports.")).toBeNull();
    expect(slot.getByText("Loading…")).toBeTruthy();
    await act(async () => {
      lists[1]!.reject(new Error("Could not load reports."));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const secondAlert = await slot.findByText("Could not load reports.");
    expect(secondAlert.getAttribute("role")).toBe("alert");
    expect(secondAlert).not.toBe(firstAlert);
  });

  it("shows loaded reports while the config has not loaded", async () => {
    let reports = [cacheMissReport()];
    const slot = render([account()], {
      "config.get": () => {
        throw new Error("Config transport failed.");
      },
      "cacheMiss.list": () => reports,
    });
    fireEvent.click(
      await slot.findByRole("button", {
        name: "Cache miss debugging 1 report",
      }),
    );
    expect(
      await slot.findByRole("list", { name: "Cache miss reports" }),
    ).toBeTruthy();
    expect(slot.queryByText("Loading…")).toBeNull();
    reports = [];
    await slot.emitRealtime(ACCOUNT_POOL_CACHE_MISSES_CHANGED, {});
    expect(await slot.findByText("No cache miss reports.")).toBeTruthy();
  });

  it("marks where a modified excerpt starts to differ and shows escaped line breaks as line breaks", async () => {
    const report = cacheMissReport();
    const slot = render([account()], {
      "cacheMiss.list": () => [
        cacheMissReport({
          divergence: {
            ...report.divergence!,
            level: "messages",
            path: "messages[1].content[0]",
            label: "user text",
            before:
              '{"type":"text","text":"# Environment\\nWorking directory: /work"}',
            after:
              '{"type":"text","text":"<reminder>\\n# Environment\\nWorking directory: /work"}',
          },
        }),
      ],
    });
    await openCacheMissSection(slot);
    const list = await slot.findByRole("list", { name: "Cache miss reports" });
    const excerpt = (label: string) =>
      within(list).getByText(label).parentElement?.querySelector("pre");
    expect(excerpt("Before")?.textContent).toBe(
      '{"type":"text","text":"# Environment\nWorking directory: /work"}',
    );
    expect(excerpt("Before")?.querySelector("mark")?.textContent).toBe(
      '# Environment\nWorking directory: /work"}',
    );
    expect(excerpt("After")?.querySelector("mark")?.textContent).toBe(
      '<reminder>\n# Environment\nWorking directory: /work"}',
    );
  });

  const editedFields: Array<{
    label: string;
    section: RegExp;
    original: string;
    typed: string;
    saved: Partial<AccountPoolConfig>;
    server: Partial<AccountPoolConfig>;
    shownServer: string;
  }> = [
    {
      label: "Minimum missed tokens",
      section: /^Cache miss debugging/,
      original: "10000",
      typed: "25000",
      saved: { cacheMissMinTokens: 25_000 },
      server: { cacheMissMinTokens: 5_000 },
      shownServer: "5000",
    },
    {
      label: "Quota switch threshold",
      section: /^Advanced/,
      original: "0.98",
      typed: "0.9",
      saved: { switchThreshold: 0.9 },
      server: { switchThreshold: 0.8 },
      shownServer: "0.8",
    },
    {
      label: "Anthropic upstream base URL",
      section: /^Advanced/,
      original: "https://api.anthropic.com",
      typed: "http://127.0.0.1:9000",
      saved: { anthropicUpstreamBaseUrl: "http://127.0.0.1:9000" },
      server: { anthropicUpstreamBaseUrl: "http://127.0.0.1:9100" },
      shownServer: "http://127.0.0.1:9100",
    },
  ];

  async function openConfigField(
    slot: ReturnType<typeof render>,
    field: (typeof editedFields)[number],
  ): Promise<HTMLInputElement> {
    fireEvent.click(await slot.findByRole("button", { name: field.section }));
    const input = await slot.findByLabelText(field.label);
    if (!(input instanceof HTMLInputElement))
      throw new Error(`Expected ${field.label} to be an input.`);
    await waitFor(() => expect(input.value).toBe(field.original));
    return input;
  }

  async function focusAndLeave(input: HTMLInputElement): Promise<void> {
    await act(async () => {
      input.focus();
      fireEvent.blur(input);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function configSets(slot: ReturnType<typeof render>) {
    return slot.rpcCalls.filter((call) => call.method === "config.set");
  }

  it.each(editedFields)(
    "shows a later server value of $label after a successful save",
    async (field) => {
      let current = config();
      const slot = render([account()], {
        "config.get": () => current,
        "config.set": () => {
          current = config(field.saved);
          return current;
        },
      });
      const input = await openConfigField(slot, field);
      fireEvent.change(input, { target: { value: field.typed } });
      fireEvent.blur(input);
      await waitFor(() => expect(configSets(slot)).toHaveLength(1));
      await waitFor(() => expect(input.disabled).toBe(false));
      current = config(field.server);
      await slot.emitRealtime(ACCOUNT_POOL_CONFIG_CHANGED, {});
      await waitFor(() => expect(input.value).toBe(field.shownServer));
      await focusAndLeave(input);
      expect(configSets(slot)).toHaveLength(1);
    },
  );

  it.each(editedFields)(
    "shows a later server value of $label after an edit is restored before leaving the field",
    async (field) => {
      let current = config();
      const slot = render([account()], {
        "config.get": () => current,
        "config.set": () => current,
      });
      const input = await openConfigField(slot, field);
      fireEvent.change(input, { target: { value: field.typed } });
      fireEvent.change(input, { target: { value: field.original } });
      fireEvent.blur(input);
      current = config(field.server);
      await slot.emitRealtime(ACCOUNT_POOL_CONFIG_CHANGED, {});
      await waitFor(() => expect(input.value).toBe(field.shownServer));
      await focusAndLeave(input);
      expect(configSets(slot)).toEqual([]);
    },
  );
});
