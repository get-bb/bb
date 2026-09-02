// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginTimelineRendererProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

function props(output: string | null): PluginTimelineRendererProps {
  return {
    row: {
      id: "item_advisor",
      threadId: "thr_test",
      turnId: "turn_test",
      kind: "provider-acp/advisor",
      toolName: null,
      status: output === null ? "pending" : "completed",
      startedAt: 1,
      completedAt: output === null ? null : 2,
    },
    payload: {
      advisor: "default",
      provider: "anthropic",
      model: "claude-fable-5-1",
      output,
      notes: [],
    },
    presentation: {
      label: {
        pending: "Advisor reviewing",
        completed: "Advisor reviewed",
      },
      icon: { glyph: "Eye" },
    },
    thread: { id: "thr_test", providerId: "acp-omp" },
    Original: () => <div>Fallback detail</div>,
  };
}

describe("OMP advisor timeline renderer", () => {
  it("registers for the OMP advisor extension kind", () => {
    expect(app.timelineRenderers).toHaveLength(1);
    expect(app.timelineRenderers[0]?.kind).toBe("provider-acp/advisor");
  });

  it("shows the complete advisor output", () => {
    const output = `**Concern:** ${"Keep this detail. ".repeat(40)}`;
    const rendered = renderSlot(app.timelineRenderers[0]!, props(output));

    expect(rendered.container.textContent).toContain("**Concern:**");
    expect(rendered.container.textContent).toContain(
      "Keep this detail. Keep this detail.",
    );
    expect(rendered.container.textContent?.length).toBeGreaterThan(280);
  });

  it("does not repeat the pending row label in its body", () => {
    const rendered = renderSlot(app.timelineRenderers[0]!, props(null));
    expect(rendered.container.textContent).toBe("");
  });
});
