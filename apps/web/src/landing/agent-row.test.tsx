import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentRow, ProviderChips, moreRegistryAgents } from "./landing-visuals";

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
    expect(html.match(/class="plogo/g)).toHaveLength(11);
    expect(html).toContain('aria-label="3 more agents">+3 more');
    expect(html).toContain('aria-label="11 more agents">+11 more');
  });

  it("keeps today's provider row markup", () => {
    const html = renderToStaticMarkup(<ProviderChips />);
    expect(html.match(/class="plogo/g)).toHaveLength(8);
    expect(html).toContain(
      '<span class="pmore" aria-label="5 more providers">+5 more</span>',
    );
    expect(html).not.toContain("pmore-desktop");
  });

  it("drops the desktop count when the registry couldn't be read", () => {
    const html = renderToStaticMarkup(<AgentRow registryIds={null} />);
    expect(html).not.toContain("pmore-desktop");
    expect(html).toContain("+8 more");
  });
});
