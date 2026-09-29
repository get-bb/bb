// @vitest-environment jsdom

import type {
  ComposerSelection,
  ComposerView,
  PluginComposerApi,
} from "@get-bb/plugin-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import { registerComposerMenuPlugins } from "@/test/fixtures/composer-menu";
import {
  setPluginSlotRegistrations,
  resetPluginSlotStoreForTest,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { ComposerSendMenu } from "./ComposerSendMenu";
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
  PromptBoxActionsMenu,
  ComposerPlusMenuSlot,
  withAppPromptActions,
} from "./PromptBoxActionsMenu";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
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
    expect(trigger.querySelector('[data-icon="Plus"]')).not.toBeNull();
    expect(trigger.querySelector('[data-icon="Spinner"]')).toBeNull();
    fireEvent.pointerDown(trigger, { button: 0 });
    const attach = await screen.findByRole("menuitem", {
      name: "Attach files",
    });
    expect(attach.getAttribute("aria-disabled")).not.toBe("true");
    expect(attach.querySelector('[data-icon="Paperclip"]')).not.toBeNull();
    expect(attach.querySelector('[data-icon="Loading"]')).toBeNull();
    fireEvent.click(attach);
    expect(onAttach).toHaveBeenCalledOnce();
  });

  it("keeps only Skills in the core action rows", async () => {
    const onAction = vi.fn();
    render(
      <PromptBoxActionsMenu
        actions={withAppPromptActions([
          { kind: "skills", text: "/skills " },
          { kind: "plan", text: "/plan " },
        ])}
        onAction={onAction}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Prompt actions" }),
      { button: 0 },
    );
    const menuItems = await screen.findAllByRole("menuitem");
    expect(menuItems.map((item) => item.textContent)).toEqual(["Skills"]);
    expect(
      menuItems.map((item) =>
        item.querySelector("[data-icon]")?.getAttribute("data-icon"),
      ),
    ).toEqual(["Zap"]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Skills" }));

    expect(onAction).toHaveBeenCalledWith({ kind: "skills", text: "/skills " });
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

  it.each(["plus", "send"] as const)(
    "reacts to selection changes for %s-menu visibility and disabled state",
    async (menu) => {
      registerComposerMenuPlugins();
      const definition = definePluginApp((app) =>
        app.composer.customize({
          id: "conditional",
          [menu === "plus" ? "plusMenu" : "sendMenu"]: [
            {
              id: "hidden",
              label: "Never shown",
              visible: false,
              run: () => {},
            },
            {
              id: "conditional",
              label: "Codex only",
              visible: (composer: PluginComposerApi) =>
                composer.selection?.providerId === "codex",
              run: () => {},
            },
            {
              id: "disabled",
              label: "Selection-dependent",
              disabled: (composer: PluginComposerApi) =>
                composer.selection?.providerId !== "codex",
              run: () => {},
            },
          ],
        }),
      );
      setPluginSlotRegistrations(
        "conditional",
        makePluginRegistrationSet(collectPluginAppRegistrations(definition)),
      );
      let selection: ComposerSelection = { providerId: "codex" };
      const listeners = new Set<() => void>();
      const draft = { ...emptyPromptDraftState(), text: "Draft" };
      const view: ComposerView = {
        scope: { kind: "new-thread", projectId: null },
        layout: "expanded",
        draft: { text: "Draft", isEmpty: false, attachmentCount: 0 },
        run: { isRunning: false, isSubmitting: false },
      };
      const host: PluginComposerHost = {
        scope: view.scope,
        textEffectKey: `conditional-${menu}`,
        getCurrent: () => draft,
        subscribeDraft: () => () => {},
        setDraft: () => {},
        focus: () => {},
        getSelection: () => selection,
        subscribeSelection: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
      render(
        <MemoryRouter>
          <PluginComposerHostProvider value={host}>
            <PluginComposerViewProvider value={view}>
              {menu === "plus" ? (
                <ComposerPlusMenuSlot onAction={() => {}} />
              ) : (
                <ComposerSendMenu
                  isPointerCoarse={false}
                  includePluginContributions
                  queue={false}
                  hasInput
                  canSubmit
                  onSubmit={undefined}
                >
                  <button>Send</button>
                </ComposerSendMenu>
              )}
            </PluginComposerViewProvider>
          </PluginComposerHostProvider>
        </MemoryRouter>,
      );
      fireEvent.pointerDown(
        screen.getByRole("button", {
          name: menu === "plus" ? "Prompt actions" : "Send options",
        }),
        { button: 0 },
      );
      expect(
        await screen.findByRole("menuitem", { name: "Codex only" }),
      ).toBeTruthy();
      expect(
        screen.queryByRole("menuitem", { name: "Never shown" }),
      ).toBeNull();
      expect(
        screen
          .getByRole("menuitem", { name: "Selection-dependent" })
          .getAttribute("aria-disabled"),
      ).not.toBe("true");
      if (menu === "plus") {
        expect(screen.getAllByRole("menuitem", { name: "Plan" })).toHaveLength(
          1,
        );
        expect(screen.getByRole("menuitem", { name: "Goal" })).toBeTruthy();
      }
      act(() => {
        selection = { providerId: "claude-code" };
        for (const listener of listeners) listener();
      });
      await waitFor(() =>
        expect(
          screen.queryByRole("menuitem", { name: "Codex only" }),
        ).toBeNull(),
      );
      expect(
        screen
          .getByRole("menuitem", { name: "Selection-dependent" })
          .getAttribute("aria-disabled"),
      ).toBe("true");
      if (menu === "plus") {
        expect(screen.getAllByRole("menuitem", { name: "Plan" })).toHaveLength(
          1,
        );
        expect(screen.queryByRole("menuitem", { name: "Goal" })).toBeNull();
        act(() => {
          selection = { providerId: "pi" };
          for (const listener of listeners) listener();
        });
        await waitFor(() =>
          expect(screen.queryByRole("menuitem", { name: "Plan" })).toBeNull(),
        );
        expect(
          screen.getByRole("menuitem", { name: "Automation" }),
        ).toBeTruthy();
      }
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

  it("renders plugin rows without a header and preserves focus deliberately moved by a plugin", async () => {
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
          run: ({ composer }) => {
            focusedByPlugin(composer.key);
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
          disabled: (composer: PluginComposerApi) => composer.isEmpty,
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
      "Improve prompt",
      "Rewrite prompt",
    ]);
    expect(screen.queryByText("Plugin")).toBeNull();
    expect(screen.queryByText("Alpha Assistant")).toBeNull();
    expect(screen.queryByText("Zeta Writer")).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Improve prompt" }));
    await waitFor(() => {
      expect(focusedByPlugin).toHaveBeenCalledWith("plus-menu-test");
      expect(document.activeElement?.id).toBe("plugin-focus-target");
    });
  });
});
