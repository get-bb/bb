// @vitest-environment jsdom

import type { ComposerView } from "@bb/plugin-sdk";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  PluginComposerHostProvider,
  PluginComposerViewProvider,
  type PluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import type { PluginComposerPlusMenuContribution } from "@/components/plugin/PluginComposerActions";
import { emptyPromptDraftState } from "@/lib/prompt-draft";
import { PromptBoxActionsMenu } from "./PromptBoxActionsMenu";

afterEach(cleanup);

describe("PromptBoxActionsMenu", () => {
  it("does not render when no prompt actions are provided", () => {
    render(<PromptBoxActionsMenu onAction={() => {}} />);

    expect(screen.queryByRole("button", { name: "Prompt actions" })).toBeNull();
  });

  it("offers file attachments even when no provider actions are available", async () => {
    const onAttach = vi.fn();
    render(<PromptBoxActionsMenu onAction={() => {}} onAttach={onAttach} />);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Prompt actions" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Attach files" }),
    );

    expect(onAttach).toHaveBeenCalledOnce();
  });

  it("keeps attachment upload progress visible on the menu trigger", () => {
    render(
      <PromptBoxActionsMenu
        isAttaching
        onAction={() => {}}
        onAttach={() => {}}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Prompt actions" });
    expect(trigger.querySelector('[data-icon="Spinner"]')).not.toBeNull();
  });

  it("renders grouped plugin items after native items and preserves run focus", async () => {
    const focusedByPlugin = vi.fn();
    const view: ComposerView = {
      scope: { kind: "new-thread", projectId: null },
      layout: "expanded",
      draft: { text: "draft", isEmpty: false, attachmentCount: 0 },
      run: { isRunning: false, isSubmitting: false },
    };
    const draft = emptyPromptDraftState();
    const host: PluginComposerHost = {
      scope: view.scope,
      draft,
      textEffectKey: "plus-menu-test",
      getCurrent: () => draft,
      setDraft: vi.fn(),
      focus: vi.fn(),
    };
    const pluginItems: readonly PluginComposerPlusMenuContribution[] = [
      {
        pluginId: "alpha",
        customizationId: "tools",
        generation: 1,
        item: {
          id: "improve",
          label: "Improve prompt",
          run: ({ view: receivedView }) => {
            focusedByPlugin(receivedView);
            document.getElementById("plugin-focus-target")?.focus();
          },
        },
      },
      {
        pluginId: "zeta",
        customizationId: "tools",
        generation: 1,
        item: {
          id: "rewrite",
          label: "Rewrite prompt",
          disabled: (receivedView) => receivedView.draft.isEmpty,
          run: vi.fn(),
        },
      },
    ];
    render(
      <MemoryRouter>
        <PluginComposerHostProvider value={host}>
          <PluginComposerViewProvider value={view}>
            <button id="plugin-focus-target">Plugin focus target</button>
            <PromptBoxActionsMenu
              actions={[{ kind: "plan", text: "/plan " }]}
              onAction={() => {}}
              pluginItems={pluginItems}
            />
          </PluginComposerViewProvider>
        </PluginComposerHostProvider>
      </MemoryRouter>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Prompt actions" }),
      { button: 0 },
    );
    const menuItems = await screen.findAllByRole("menuitem");
    expect(menuItems.map((item) => item.textContent)).toEqual([
      "Plan",
      "Improve prompt",
      "Rewrite prompt",
    ]);
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("zeta")).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Improve prompt" }));
    await waitFor(() => {
      expect(focusedByPlugin).toHaveBeenCalledWith(view);
      expect(document.activeElement?.id).toBe("plugin-focus-target");
    });
  });
});
