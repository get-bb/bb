// @vitest-environment jsdom

import type { ComposerView } from "@get-bb/plugin-sdk";
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
import { emptyPromptDraftState } from "@bb/client-core";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import {
  CREATE_PLUGIN_PROMPT_ACTION,
  PromptBoxActionsMenu,
  withAppPromptActions,
} from "./PromptBoxActionsMenu";

afterEach(() => {
  cleanup();
  resetPluginLogoStoreForTest();
});

describe("PromptBoxActionsMenu", () => {
  it("does not render when no prompt actions are provided", () => {
    render(<PromptBoxActionsMenu onAction={() => {}} />);

    expect(screen.queryByRole("button", { name: "Prompt actions" })).toBeNull();
  });

  it("offers file attachments even when no provider actions are available", async () => {
    const onAttach = vi.fn();
    render(<PromptBoxActionsMenu onAction={() => {}} onAttach={onAttach} />);

    const trigger = screen.getByRole("button", { name: "Prompt actions" });
    expect(trigger.classList).toContain("text-subtle-foreground/75");
    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Attach files" }),
    );

    expect(onAttach).toHaveBeenCalledOnce();
  });

  it("keeps the plus menu trigger stable during attachment uploads", () => {
    render(
      <PromptBoxActionsMenu
        isAttaching
        onAction={() => {}}
        onAttach={() => {}}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Prompt actions" });
    expect(trigger.querySelector('[data-icon="Plus"]')).not.toBeNull();
    expect(trigger.querySelector('[data-icon="Spinner"]')).toBeNull();
  });

  it("seeds the composer with the plugin prompt after the provider actions", async () => {
    const onAction = vi.fn();
    render(
      <PromptBoxActionsMenu
        actions={withAppPromptActions([
          { kind: "skills", text: "/skills " },
          { kind: "plan", text: "/plan " },
        ])}
        onAction={onAction}
        onAttach={() => {}}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Prompt actions" }),
      { button: 0 },
    );
    const menuItems = await screen.findAllByRole("menuitem");
    expect(menuItems.map((item) => item.textContent)).toEqual([
      "Attach files",
      "Use skill…",
      "Plan",
      "Automation",
      "Plugin",
    ]);
    expect(
      menuItems.map((item) =>
        item.querySelector("[data-icon]")?.getAttribute("data-icon"),
      ),
    ).toEqual(["Paperclip", "Zap", "ListTodo", "Repeat", "ElectricPlugs"]);
    const createLabel = screen.getByText("Create");
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    expect(menuItems[0].nextElementSibling?.getAttribute("role")).toBe(
      "separator",
    );
    expect(createLabel.previousElementSibling?.getAttribute("role")).toBe(
      "separator",
    );
    expect(createLabel.nextElementSibling).toBe(
      screen.getByRole("menuitem", { name: "Automation" }),
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Plugin" }));

    expect(onAction).toHaveBeenCalledWith(CREATE_PLUGIN_PROMPT_ACTION);
  });

  it("keeps a provider-owned action instead of the app copy", () => {
    const providerPlugin = { kind: "plugin", text: "/plugin " } as const;

    expect(withAppPromptActions([providerPlugin])).toEqual([
      providerPlugin,
      {
        kind: "automation",
        command: { trigger: "/", name: "automation", trailingText: " " },
        text: "/automation ",
      },
    ]);
  });

  it("omits creation chrome when no creation actions are visible", async () => {
    render(
      <PromptBoxActionsMenu
        actions={[
          { kind: "skills", text: "/" },
          { kind: "plan", text: "/plan " },
          { kind: "automation", text: "" },
        ]}
        onAction={() => {}}
        onAttach={() => {}}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Prompt actions" }),
      { button: 0 },
    );
    await screen.findByRole("menuitem", { name: "Use skill…" });
    expect(screen.queryByText("Create")).toBeNull();
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(screen.getByRole("separator").previousElementSibling).toBe(
      screen.getByRole("menuitem", { name: "Attach files" }),
    );
  });

  it.each([false, true])(
    "avoids extra dividers for a lone creation action with attachments %s",
    async (withAttachments) => {
      render(
        <PromptBoxActionsMenu
          actions={[CREATE_PLUGIN_PROMPT_ACTION]}
          onAction={() => {}}
          onAttach={withAttachments ? () => {} : undefined}
        />,
      );

      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Prompt actions" }),
        { button: 0 },
      );
      const plugin = await screen.findByRole("menuitem", { name: "Plugin" });
      expect(screen.getByText("Create").nextElementSibling).toBe(plugin);
      expect(screen.queryAllByRole("separator")).toHaveLength(
        withAttachments ? 1 : 0,
      );
    },
  );

  it("restores composer focus after an update-only plugin item", async () => {
    const view: ComposerView = {
      scope: { kind: "new-thread", projectId: null },
      layout: "expanded",
      draft: { text: "draft", isEmpty: false, attachmentCount: 0 },
      run: { isRunning: false, isSubmitting: false },
    };
    const draft = { ...emptyPromptDraftState(), text: "draft" };
    const setDraft = vi.fn();
    const host: PluginComposerHost = {
      scope: view.scope,
      textEffectKey: "plus-menu-update-test",
      getCurrent: () => draft,
      subscribeDraft: () => () => {},
      setDraft,
      focus: () => document.getElementById("composer-focus-target")?.focus(),
    };
    const pluginItems: readonly PluginComposerPlusMenuContribution[] = [
      {
        key: "update-plugin/1/tools/update",
        pluginId: "update-plugin",
        customizationId: "tools",
        generation: 1,
        item: {
          id: "update",
          label: "Update prompt",
          run: ({ composer }) =>
            composer.updateText((current) => `${current}!`),
        },
      },
    ];
    render(
      <MemoryRouter>
        <PluginComposerHostProvider value={host}>
          <PluginComposerViewProvider value={view}>
            <input id="composer-focus-target" aria-label="Composer" />
            <PromptBoxActionsMenu
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
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Update prompt" }),
    );

    await waitFor(() => {
      expect(setDraft).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "Composer" }),
      );
    });
  });

  it("renders display-name groups and preserves focus deliberately moved by a plugin", async () => {
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
      textEffectKey: "plus-menu-test",
      getCurrent: () => draft,
      subscribeDraft: () => () => {},
      setDraft: vi.fn(),
      focus: vi.fn(),
    };
    const pluginItems: readonly PluginComposerPlusMenuContribution[] = [
      {
        key: "alpha/1/tools/improve",
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
        key: "zeta/1/tools/rewrite",
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
    setPluginLogoUrls(
      new Map([
        [
          "alpha",
          {
            displayName: "Alpha Assistant",
            icon: null,
            compactIconUrl: null,
            logoUrl: null,
            logoDarkUrl: null,
            icons: new Map(),
          },
        ],
        [
          "zeta",
          {
            displayName: "Zeta Writer",
            icon: null,
            compactIconUrl: null,
            logoUrl: null,
            logoDarkUrl: null,
            icons: new Map(),
          },
        ],
      ]),
    );
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
    expect(screen.getByText("Alpha Assistant")).toBeTruthy();
    expect(screen.getByText("Zeta Writer")).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Improve prompt" }));
    await waitFor(() => {
      expect(focusedByPlugin).toHaveBeenCalledWith(view);
      expect(document.activeElement?.id).toBe("plugin-focus-target");
    });
  });
});
