import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { UsageSettingsContent } from "./settings.js";
import type { UsageMachine, UsageProvider } from "./usage-schema.js";

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
