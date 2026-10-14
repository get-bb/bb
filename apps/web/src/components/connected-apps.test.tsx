import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OAuthGrantView } from "@/server/oauth";
import { ConnectedApps } from "./connected-apps";

function grant(overrides: Partial<OAuthGrantView>): OAuthGrantView {
  return {
    id: "grant-1",
    clientId: "https://claude.ai/oauth/client",
    clientName: "Claude",
    serverId: "server-1",
    serverHandle: "sawyer",
    scope: "bb",
    createdAt: Date.UTC(2026, 5, 15, 12),
    lastUsedAt: null,
    ...overrides,
  };
}

function render(grants: OAuthGrantView[], revokingId: string | null = null) {
  return renderToStaticMarkup(
    <ConnectedApps
      grants={grants}
      revokingId={revokingId}
      relativeTime={() => "3h ago"}
      onRevoke={() => {}}
    />,
  );
}

describe("dashboard connected apps", () => {
  it("renders nothing when no app is connected", () => {
    expect(render([])).toBe("");
  });

  it("lists each app with its bb, connected date, and usage", () => {
    const html = render([
      grant({ id: "a", clientName: "Claude", serverHandle: "sawyer" }),
      grant({
        id: "b",
        clientName: "ChatGPT",
        serverHandle: "work",
        lastUsedAt: Date.UTC(2026, 5, 16),
      }),
    ]);
    expect(html).toContain("Connected apps");
    const [first, second] = html.split("ChatGPT");
    expect(first).toContain("Claude");
    expect(first).toContain("sawyer");
    expect(first).toContain("Connected Jun 15, 2026");
    expect(first).toContain("Never used");
    expect(second).toContain("work");
    expect(second).toContain("Last used 3h ago");
    expect(html.match(/>Revoke</gu)).toHaveLength(2);
  });

  it("disables only the row being revoked", () => {
    const html = render([grant({ id: "a" }), grant({ id: "b" })], "b");
    expect(html.match(/<button[^>]*disabled=""[^>]*>Revoking…/gu)).toHaveLength(
      1,
    );
    expect(html.match(/>Revoke</gu)).toHaveLength(1);
  });
});
