import { describe, expect, it, vi } from "vitest";
import type {
  PluginComposerCustomizationSlot,
  PluginFileOpenerSlot,
  PluginMessageDirectiveSlot,
  PluginPendingInteractionSlot,
} from "./plugin-slots";
import {
  BUILT_IN_REPLACEMENT_PROVIDER,
  replacementProviderKey,
} from "./plugin-replacement-preference";
import {
  resolveComposerActions,
  resolveComposerBanners,
  resolveComposerDraftObservers,
  resolveComposerEditorEffects,
  resolveComposerPlusMenuItems,
  resolveFileOpenerReplacement,
  resolveMessageDirectiveRegistry,
  resolvePendingInteraction,
  resolveReplacement,
} from "./plugin-slot-resolvers";

const SETTLED_BOOT = {
  bbPluginIds: new Set<string>(),
  settled: true,
  settledOnce: true,
};

function openerFor(
  args: Omit<
    Parameters<typeof resolveFileOpenerReplacement>[0],
    "boot" | "picks"
  > & { picks?: Readonly<Record<string, string>> },
) {
  return resolveFileOpenerReplacement({
    picks: {},
    boot: SETTLED_BOOT,
    ...args,
  });
}

function Component() {
  return null;
}

function composerCustomization(
  overrides: Partial<PluginComposerCustomizationSlot> &
    Pick<PluginComposerCustomizationSlot, "id">,
): PluginComposerCustomizationSlot {
  return {
    pluginId: "composer-plugin",
    generation: 1,
    ...overrides,
  };
}

describe("Composer slot resolvers", () => {
  it("projects applicable contributions in registration order with generation keys", () => {
    const onDraftChange = vi.fn();
    const match = () => [];
    const all = composerCustomization({
      id: "all",
      actions: [{ id: "action", component: Component }],
      banners: [{ id: "banner", component: Component }],
      plusMenu: [{ id: "menu", label: "Menu", run: () => {} }],
      richText: {
        effects: [{ id: "effect", className: "effect", match }],
        onDraftChange,
      },
    });
    const thread = composerCustomization({
      id: "thread",
      scopes: ["thread"],
      actions: [{ id: "thread-action", component: Component }],
    });
    const newThread = composerCustomization({
      id: "new-thread",
      scopes: ["new-thread"],
      actions: [{ id: "hidden", component: Component }],
    });

    expect(resolveComposerActions([all, thread, newThread], "thread")).toEqual([
      expect.objectContaining({
        key: "composer-plugin/1/all/action",
        customizationId: "all",
      }),
      expect.objectContaining({
        key: "composer-plugin/1/thread/thread-action",
        customizationId: "thread",
      }),
    ]);
    expect(resolveComposerBanners([all], "thread")[0]?.banner.id).toBe(
      "banner",
    );
    expect(resolveComposerPlusMenuItems([all], "thread")[0]?.item.id).toBe(
      "menu",
    );
    expect(resolveComposerEditorEffects([all], "thread")[0]).toEqual(
      expect.objectContaining({ effects: all.richText?.effects }),
    );
    expect(resolveComposerDraftObservers([all], "thread")[0]).toEqual(
      expect.objectContaining({ onDraftChange }),
    );
  });

  it("treats omitted scopes as all, empty scopes as none, and changes keys by generation", () => {
    const all = composerCustomization({
      id: "all",
      actions: [{ id: "action", component: Component }],
    });
    const none = composerCustomization({
      id: "none",
      scopes: [],
      actions: [{ id: "hidden", component: Component }],
    });

    expect(resolveComposerActions([all, none], "queued-message")).toHaveLength(
      1,
    );
    expect(
      resolveComposerActions([{ ...all, generation: 2 }], "queued-message")[0]
        ?.key,
    ).toBe("composer-plugin/2/all/action");
  });
});

describe("keyed renderer resolvers", () => {
  it("resolves pending interactions by plugin and renderer id", () => {
    const mine: PluginPendingInteractionSlot = {
      pluginId: "mine",
      generation: 1,
      id: "form",
      component: Component,
    };
    const theirs = { ...mine, pluginId: "theirs" };

    expect(resolvePendingInteraction([theirs, mine], "mine", "form")).toBe(
      mine,
    );
    expect(resolvePendingInteraction([mine], "mine", "missing")).toBeNull();
  });

  it("resolves unique directives and reports deterministic collisions", () => {
    const alpha: PluginMessageDirectiveSlot = {
      pluginId: "zeta",
      generation: 1,
      id: "card",
      component: Component,
    };
    const beta = { ...alpha, pluginId: "alpha" };
    const chart = { ...alpha, id: "chart" };

    expect(
      resolveMessageDirectiveRegistry(
        [alpha, beta, chart],
        {},
        SETTLED_BOOT,
      ).get("card"),
    ).toEqual({ status: "collision", pluginIds: ["alpha", "zeta"] });
  });
});

describe("replacement resolvers", () => {
  it("selects the first applicable provider and reveals the next after removal", () => {
    const alpha = { id: "alpha", applies: false };
    const beta = { id: "beta", applies: true };
    const gamma = { id: "gamma", applies: true };

    expect(
      resolveReplacement([alpha, beta, gamma], (candidate) =>
        Boolean(candidate.applies),
      ),
    ).toEqual({ kind: "plugin", registration: beta });
    expect(
      resolveReplacement([alpha, gamma], (candidate) =>
        Boolean(candidate.applies),
      ),
    ).toEqual({ kind: "plugin", registration: gamma });
    expect(resolveReplacement([], () => true)).toEqual({ kind: "owner" });
  });

  it("activates the first matching file opener and preserves per-open overrides", () => {
    const markdown: PluginFileOpenerSlot = {
      pluginId: "docs",
      generation: 1,
      id: "editor",
      title: "Editor",
      extensions: ["md"],
      component: Component,
    };
    const text = { ...markdown, id: "text", extensions: ["txt"] };
    const alternate = {
      ...markdown,
      pluginId: "alternate",
      id: "preview",
      title: "Preview",
    };

    expect(
      openerFor({
        registrations: [markdown, text],
        path: "README.MD",
      }),
    ).toEqual({ kind: "plugin", registration: markdown });
    expect(
      openerFor({
        registrations: [markdown, alternate],
        picks: { md: BUILT_IN_REPLACEMENT_PROVIDER },
        path: "README.md",
      }),
    ).toEqual({ kind: "owner" });
    expect(
      openerFor({
        registrations: [markdown, alternate],
        picks: { md: replacementProviderKey(alternate) },
        path: "README.md",
      }),
    ).toEqual({ kind: "plugin", registration: alternate });
    expect(
      openerFor({
        registrations: [markdown, text],
        path: "README.md",
        override: { pluginId: "docs", openerId: "text" },
      }),
    ).toEqual({ kind: "plugin", registration: text });
    expect(
      openerFor({
        registrations: [markdown],
        path: "README.md",
        override: "builtin",
      }),
    ).toEqual({ kind: "owner" });
    expect(
      openerFor({
        registrations: [],
        path: "README.md",
      }),
    ).toEqual({ kind: "owner" });
  });

  it("reveals the next matching file opener when the first is removed", () => {
    const first: PluginFileOpenerSlot = {
      pluginId: "alpha",
      generation: 1,
      id: "markdown",
      title: "Alpha Markdown",
      extensions: ["md"],
      component: Component,
    };
    const second = { ...first, pluginId: "beta", title: "Beta Markdown" };

    expect(
      openerFor({
        registrations: [first, second],
        path: "README.md",
      }),
    ).toEqual({ kind: "plugin", registration: first });
    expect(
      openerFor({
        registrations: [second],
        path: "README.md",
      }),
    ).toEqual({ kind: "plugin", registration: second });
    expect(
      openerFor({
        registrations: [second],
        picks: { md: replacementProviderKey(first) },
        path: "README.md",
      }),
    ).toEqual({ kind: "plugin", registration: second });
  });
});
