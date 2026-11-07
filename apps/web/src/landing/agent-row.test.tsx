import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentRow, moreRegistryAgents } from "./landing-visuals";

describe("AgentRow", () => {
  it("counts registry agents the marks don't already show", () => {
    expect(
      moreRegistryAgents(["claude-acp", "opencode-v2", "goose", "kiro"]),
    ).toBe(2);
    expect(moreRegistryAgents(null)).toBeNull();
  });

  it("shows every mark, then the registry count", () => {
    const html = renderToStaticMarkup(
      <AgentRow registryIds={["claude-acp", "goose", "kiro", "cline"]} />,
    );
    expect(html.match(/class="plogo/g)).toHaveLength(10);
    expect(html).toContain('aria-label="3 more agents">+3 more');
    expect(html).toContain('aria-label="10 more agents">+10 more');
  });

  it("offers a phone count for every number of marks that fits", () => {
    const html = renderToStaticMarkup(
      <AgentRow registryIds={["claude-acp", "goose", "kiro", "cline"]} />,
    );
    for (let shown = 3; shown <= 10; shown += 1) {
      expect(html).toContain(
        `class="agent-phone-more agent-phone-more-${shown}" aria-label="${13 - shown} more agents">+${13 - shown} more`,
      );
    }
  });

  it("drops the desktop count when the registry couldn't be read", () => {
    const html = renderToStaticMarkup(<AgentRow registryIds={null} />);
    expect(html).not.toContain("agent-more");
    expect(html).toContain("+7 more");
  });
});
