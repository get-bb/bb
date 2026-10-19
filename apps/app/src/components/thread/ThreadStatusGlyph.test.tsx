// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginSidebarThreadIndicator } from "@get-bb/plugin-sdk";
import {
  SIDEBAR_SUCCESS_STATUS_COLOR_CLASS,
  SIDEBAR_WORKING_STATUS_COLOR_CLASS,
} from "@bb/shared-ui/sidebar-row-classes";
import { ThreadStatusGlyph } from "./ThreadStatusGlyph";

afterEach(() => {
  cleanup();
});

describe("ThreadStatusGlyph", () => {
  it.each([
    ["unread-error", "Unread thread failed", "CircleX"],
    ["queued-failed", "Queued message failed to send", "CircleX"],
    ["waiting-for-input", "Thread needs user input", "CircleQuestion"],
    ["queued-waiting", "Thread has a message waiting to send", "Clock"],
    ["working-draft", "Thread working with unsubmitted draft", "Edit"],
    ["workflow", "Workflow running", "Workflow"],
    ["background-agent", "Background agent running", "UserRoundPlus"],
    ["background-command", "Background command running", "Terminal"],
    ["plan-mode", "Plan mode active", "ListTodo"],
    ["goal", "Goal active", "Target"],
    ["runtime", "Thread working", "Loading"],
    ["draft", "Thread has unsubmitted draft", "Edit"],
  ] satisfies [PluginSidebarThreadIndicator, string, string][])(
    "draws %s as a labelled %s glyph",
    (indicator, label, icon) => {
      render(<ThreadStatusGlyph indicator={indicator} />);

      expect(screen.getByLabelText(label).getAttribute("data-icon")).toBe(icon);
    },
  );

  it("shimmers named work and spins the runtime glyph unless motion is reduced", () => {
    const { rerender } = render(<ThreadStatusGlyph indicator="workflow" />);
    const workflow = screen.getByLabelText("Workflow running");
    expect(Array.from(workflow.classList)).toContain("animate-shine-icon");
    expect(Array.from(workflow.classList)).toContain(
      SIDEBAR_WORKING_STATUS_COLOR_CLASS,
    );

    rerender(<ThreadStatusGlyph indicator="runtime" />);
    const runtime = screen.getByLabelText("Thread working");
    expect(Array.from(runtime.classList)).toContain("animate-spin");
    expect(Array.from(runtime.classList)).toContain("motion-reduce:animate-none");
  });

  it("draws unread success as a dot and nothing for none", () => {
    const { container, rerender } = render(
      <ThreadStatusGlyph indicator="unread-success" />,
    );
    expect(screen.getByLabelText("Unread thread succeeded").tagName).toBe(
      "SPAN",
    );

    rerender(<ThreadStatusGlyph indicator="none" />);
    expect(container.firstChild).toBeNull();
  });

  it("hides the idle draft glyph from assistive technology on request", () => {
    const { container } = render(
      <ThreadStatusGlyph indicator="draft" hideIdleDraftLabel />,
    );

    const draft = container.querySelector('[data-icon="Edit"]');
    expect(draft?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByLabelText("Thread has unsubmitted draft")).toBeNull();
  });

  it("draws the archive glyph for archived threads", () => {
    render(<ThreadStatusGlyph indicator="runtime" archived />);

    expect(screen.getByLabelText("Archived thread").getAttribute("data-icon")).toBe(
      "Archive",
    );
  });

  it.each([
    ["running", "animate-shine-icon"],
    ["success", SIDEBAR_SUCCESS_STATUS_COLOR_CLASS],
    ["error", "text-destructive"],
  ] as const)("draws a %s row status with its tone", (tone, className) => {
    render(
      <ThreadStatusGlyph
        indicator="draft"
        rowStatus={{ icon: "AiContentGenerator01", label: "Improving", tone }}
      />,
    );

    const status = screen.getByLabelText("Improving");
    expect(status.getAttribute("data-icon")).toBe("AiContentGenerator01");
    expect(Array.from(status.classList)).toContain(className);
    expect(screen.queryByLabelText("Thread has unsubmitted draft")).toBeNull();
  });

  it.each([
    ["runtime", "Thread working"],
    ["unread-error", "Unread thread failed"],
    ["waiting-for-input", "Thread needs user input"],
  ] satisfies [PluginSidebarThreadIndicator, string][])(
    "keeps %s ahead of a row status",
    (indicator, label) => {
      render(
        <ThreadStatusGlyph
          indicator={indicator}
          rowStatus={{ icon: "AiContentGenerator01", label: "Improving" }}
        />,
      );

      expect(screen.getByLabelText(label)).not.toBeNull();
      expect(screen.queryByLabelText("Improving")).toBeNull();
    },
  );
});
