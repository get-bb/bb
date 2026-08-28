// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeneralSettingsSection, ThreadsSettingsSection } from "./SettingsView";

afterEach(cleanup);

describe("ThreadsSettingsSection", () => {
  it("distinguishes conversation retention from environment cleanup", () => {
    render(
      <ThreadsSettingsSection
        archivedConversationRetention="forever"
        archivedConversationRetentionDisabled={false}
        navigateToThreadAfterCreate
        onArchivedConversationRetentionChange={vi.fn()}
        onNavigateToThreadAfterCreateChange={vi.fn()}
        onRichTextEditingChange={vi.fn()}
        onSteerActiveThreadOnEnterChange={vi.fn()}
        richTextEditing
        steerActiveThreadOnEnter={false}
        steerActiveThreadOnEnterDisabled={false}
      />,
    );

    expect(screen.getByText("Threads")).toBeDefined();
    expect(
      screen.getByLabelText("Navigate to threads on creation"),
    ).toBeDefined();
    expect(
      screen.getByLabelText("Markdown formatting in prompt box"),
    ).toBeDefined();
    expect(
      screen.getByLabelText("Steer running threads on Enter"),
    ).toBeDefined();
    expect(
      screen.getByLabelText("Keep archived conversations").textContent,
    ).toContain("Forever");
    expect(
      screen.getByText(
        "Controls conversation history only. Thread environments are removed 24 hours after archiving.",
      ),
    ).toBeDefined();
    expect(
      screen.queryByText(/Use Enter to steer the current run/u),
    ).toBeNull();
  });

  it("reports the selected archived-conversation retention", async () => {
    const onChange = vi.fn();
    render(
      <ThreadsSettingsSection
        archivedConversationRetention="forever"
        archivedConversationRetentionDisabled={false}
        navigateToThreadAfterCreate
        onArchivedConversationRetentionChange={onChange}
        onNavigateToThreadAfterCreateChange={vi.fn()}
        onRichTextEditingChange={vi.fn()}
        onSteerActiveThreadOnEnterChange={vi.fn()}
        richTextEditing
        steerActiveThreadOnEnter={false}
        steerActiveThreadOnEnterDisabled={false}
      />,
    );

    fireEvent.pointerDown(
      screen.getByLabelText("Keep archived conversations"),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "For 30 days" }),
    );
    expect(onChange).toHaveBeenCalledWith("30-days");
  });
});

describe("GeneralSettingsSection", () => {
  it("does not duplicate thread-owned controls", () => {
    render(
      <GeneralSettingsSection
        desktopBrowserAvailable
        onOpenLinksInAppBrowserChange={vi.fn()}
        onRewriteLocalhostLinksChange={vi.fn()}
        onStreamerModeChange={vi.fn()}
        openLinksInAppBrowser
        rewriteLocalhostLinks
        streamerMode={false}
        streamerModeDisabled={false}
      />,
    );

    expect(
      screen.queryByLabelText("Navigate to threads on creation"),
    ).toBeNull();
    expect(
      screen.queryByLabelText("Markdown formatting in prompt box"),
    ).toBeNull();
    expect(
      screen.queryByLabelText("Steer running threads on Enter"),
    ).toBeNull();
  });
});
