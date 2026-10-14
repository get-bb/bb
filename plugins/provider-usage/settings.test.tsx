import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import type { UsageRequest } from "./server.js";
import { loadUsage, UsageSettingsContent } from "./settings.js";
import type {
  UsageMachine,
  UsageProvider,
  UsageSnapshot,
} from "./usage-schema.js";

installTestPluginRuntime();

function account(id: string, providerId = "codex"): UsageProvider {
  return {
    id,
    providerId,
    accountLabel: `${id}@example.com`,
    displayName: providerId === "codex" ? "Codex" : "Claude Code",
    logoUrl: null,
    icon: null,
    strings: { iconTint: null },
    signInHint: "Sign in again.",
    expiredHint: "Session expired.",
    usage: {
      status: "ok",
      accountEmail: `${id}@example.com`,
      planLabel: "Max (20x)",
      windows: [
        {
          label: "Weekly limit",
          usedPercent: 42,
          resetsAt: new Date(Date.now() + 3600_000).toISOString(),
          cost: null,
        },
      ],
    },
  };
}
const machine = (id: string, providers: UsageProvider[]): UsageMachine => ({
  id,
  displayName: id === "source:pool" ? "Account Pooler" : "My machine",
  status: "connected",
  error: null,
  providers,
});

function usageState() {
  const state: { machines: UsageMachine[]; error: boolean } = {
    machines: [],
    error: false,
  };
  return {
    state,
    target: {
      disposed: () => false,
      setMachines: (machines: UsageMachine[]) => {
        state.machines = machines;
      },
      setError: (error: boolean) => {
        state.error = error;
      },
    },
  };
}

function recordingUsage(respond: (input: UsageRequest) => UsageSnapshot) {
  const calls: UsageRequest[] = [];
  const getUsage = async (input: UsageRequest) => {
    calls.push(input);
    return respond(input);
  };
  return { calls, getUsage };
}

function renderContent(
  props: Partial<Parameters<typeof UsageSettingsContent>[0]>,
) {
  return renderToStaticMarkup(
    <UsageSettingsContent
      machines={[]}
      selectedId={null}
      loading={false}
      error={false}
      onSelect={() => {}}
      onRefresh={() => {}}
      {...props}
    />,
  );
}

describe("loadUsage", () => {
  it("fetches all providers only in the selected source and forwards force", async () => {
    const machines = [
      machine("host", [account("local")]),
      machine("source:pool", [
        account("first"),
        account("second"),
        account("third", "claude-code"),
      ]),
    ];
    const { calls, getUsage } = recordingUsage(() => ({ machines }));
    const { state, target } = usageState();
    await loadUsage(getUsage, null, false, target);
    expect(calls).toEqual([
      { force: false, machineIds: null, providerIds: [], maxAgeMs: 60_000 },
      {
        force: false,
        machineIds: ["source:pool"],
        providerIds: ["codex", "claude-code"],
        maxAgeMs: 60_000,
      },
    ]);
    expect(state.machines).toBe(machines);
    await loadUsage(getUsage, null, true, target);
    expect(calls[3]).toMatchObject({
      force: true,
      machineIds: ["source:pool"],
    });
  });

  it("uses machine usage when the pool is disabled", async () => {
    const { calls, getUsage } = recordingUsage(() => ({
      machines: [machine("host", [account("local")])],
    }));
    await loadUsage(getUsage, null, false, usageState().target);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      machineIds: ["host"],
      providerIds: ["codex"],
    });
  });

  it("keeps an enabled empty pool selected without fetching machine quotas", async () => {
    const machines = [
      machine("host", [account("local")]),
      machine("source:pool", []),
    ];
    const { calls, getUsage } = recordingUsage(() => ({ machines }));
    const { state, target } = usageState();
    await loadUsage(getUsage, null, false, target);
    expect(calls).toHaveLength(1);
    expect(state.machines).toBe(machines);
  });

  it("retains measured accounts when reloading fails", async () => {
    const measured = [machine("source:pool", [account("first")])];
    let failed = false;
    const getUsage = async () => {
      if (failed) throw new Error("private transport detail");
      return { machines: measured };
    };
    const { state, target } = usageState();
    await loadUsage(getUsage, null, false, target);
    failed = true;
    await loadUsage(getUsage, null, true, target);
    expect(state).toEqual({ machines: measured, error: true });
    const html = renderContent({ machines: state.machines, error: true });
    expect(html).toContain("Showing last update");
    expect(html).toContain("first@example.com");
    expect(html).toContain("42% used");
  });

  it("reports a transport failure without keeping the raw error", async () => {
    const { state, target } = usageState();
    await loadUsage(
      async () => {
        throw new Error("Unexpected token 'b', bb connect...");
      },
      null,
      false,
      target,
    );
    expect(state).toEqual({ machines: [], error: true });
    const html = renderContent({ error: true });
    expect(html).toContain("Couldn’t load usage.");
    expect(html).not.toContain("Retry usage refresh");
  });
});

describe("UsageSettingsContent", () => {
  it("groups the selected source's accounts with icons, labels and reset times", () => {
    const html = renderContent({
      machines: [
        machine("host", [account("local")]),
        machine("source:pool", [
          account("first"),
          account("second"),
          account("third", "claude-code"),
        ]),
      ],
    });
    expect(html.match(/<h3[^>]*>Codex<\/h3>/g)).toHaveLength(2);
    expect(html).toContain("first@example.com");
    expect(html).toContain("second@example.com");
    expect(html).not.toContain("local@example.com");
    expect(html.match(/Resets in/g)).toHaveLength(3);
  });

  it("renders loading before any source is known", () => {
    expect(renderContent({ loading: true })).toContain("Loading usage…");
  });

  it("shows pending measurements without inventing usage, then reports an unavailable account gracefully", () => {
    const resource = { ...account("pending"), usage: null };
    const pending = renderContent({
      machines: [machine("source:pool", [resource])],
      loading: true,
    });
    expect(pending).toContain("Loading usage…");
    expect(pending).not.toContain("0% used");
    const failed = renderContent({
      machines: [
        {
          ...machine("source:pool", [resource]),
          error: "Some usage could not be refreshed.",
        },
      ],
    });
    expect(failed).toContain("Couldn’t load usage.");
    expect(failed).toContain("Usage unavailable.");
    expect(failed).not.toContain("Showing the last");
  });

  it("keeps authentication and plans without limits distinct from loading and errors", () => {
    const first = account("signed-out");
    first.usage = { status: "unauthenticated" };
    const second = account("expired");
    second.usage = { status: "expired" };
    const third = account("unlimited");
    third.usage = {
      status: "ok",
      accountEmail: "unlimited@example.com",
      planLabel: null,
      windows: [],
    };
    const html = renderContent({
      machines: [machine("source:pool", [first, second, third])],
    });
    expect(html).toContain("Sign in again.");
    expect(html).toContain("Session expired.");
    expect(html).toContain("No usage limits reported for this plan.");
    expect(html).not.toContain("0% used");
  });
});
