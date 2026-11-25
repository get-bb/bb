// @vitest-environment jsdom

import type { ReactNode } from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { createStore, Provider as JotaiProvider, useAtomValue } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffRendererProviderAtom,
  sourceCodeRendererProviderAtom,
  useDiffRendererReplacement,
  useSourceCodeRendererReplacement,
} from "@/components/code/codeRendererProvider";
import {
  threadHeaderTitleProviderAtom,
  usePluginThreadHeaderTitle,
} from "@/components/plugin/PluginThreadHeaderTitle";
import { usePluginThreadRailOutline } from "@/components/plugin/PluginThreadRail";
import { threadRailOutlineProviderAtom } from "@/components/plugin/thread-rail-outline-pick";
import {
  composerRendererProviderAtom,
  useComposerReplacement,
} from "@/components/promptbox/composer-provider";
import {
  MarkdownRendererChoicesSection,
  FileOpenerChoicesSection,
  PluginSlotChoiceRows,
} from "@/components/settings/PluginChoiceSettings";
import {
  sidebarNavigationProviderAtom,
  useResolvedSidebarNavigation,
} from "@/components/sidebar/sidebarNavigationProvider";
import {
  threadListProviderAtom,
  useThreadListReplacement,
} from "@/components/sidebar/threadListProvider";
import { fileOpenerPreferenceAtom } from "@/lib/file-opener-preference";
import { codeFencePicksAtom } from "@/lib/plugin-choice-picks";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
  setPluginFrontendReconcilePending,
} from "@/lib/plugin-frontend-boot-state";
import {
  useExclusiveBootState,
  type ExclusiveResolution,
} from "@/lib/plugin-replacement-preference";
import {
  resolveCodeFenceRendererRegistry,
  resolveFileOpenerReplacement,
} from "@/lib/plugin-slot-resolvers";
import {
  resetPluginSlotStoreForTest,
  setBuiltinPluginIds,
  setOfficialMarketplacePluginIds,
  setPluginSlotRegistrations,
  usePluginSlotKind,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

type Store = ReturnType<typeof createStore>;

interface Provider {
  pluginId: string;
  id: string;
  title: string;
}

interface PinnedSurface {
  name: string;
  settingLabel: string;
  setPick: (store: Store, pick: string) => void;
  registrations: (provider: Provider) => Partial<PluginRegistrationSet>;
  optionTitle: (provider: Provider) => string;
  useResolvedPluginId: () => string | null;
}

const component = () => null;

function resolvedPluginId(
  resolved: ExclusiveResolution<{ pluginId: string }>,
): string | null {
  return resolved.kind === "plugin" ? resolved.registration.pluginId : null;
}

const SURFACES: PinnedSurface[] = [
  {
    name: "composer",
    settingLabel: "Composer",
    setPick: (store, pick) => store.set(composerRendererProviderAtom, pick),
    registrations: ({ id, title }) => ({
      composers: [{ id, title, component }],
    }),
    optionTitle: (provider) => provider.title,
    useResolvedPluginId: () => resolvedPluginId(useComposerReplacement()),
  },
  {
    name: "thread list",
    settingLabel: "Sidebar thread list",
    setPick: (store, pick) => store.set(threadListProviderAtom, pick),
    registrations: ({ id, title }) => ({
      threadLists: [{ id, title, component }],
    }),
    optionTitle: (provider) => provider.title,
    useResolvedPluginId: () => resolvedPluginId(useThreadListReplacement()),
  },
  {
    name: "sidebar navigation",
    settingLabel: "Navigation",
    setPick: (store, pick) => store.set(sidebarNavigationProviderAtom, pick),
    registrations: ({ id, title }) => ({
      experimentalSidebarNavigations: [
        { id, title, placement: "rail", component },
      ],
    }),
    optionTitle: (provider) => provider.title,
    useResolvedPluginId: () => {
      const resolved = useResolvedSidebarNavigation();
      return resolved.kind === "plugin" ? resolved.slot.pluginId : null;
    },
  },
  {
    name: "source code renderer",
    settingLabel: "Source code",
    setPick: (store, pick) => store.set(sourceCodeRendererProviderAtom, pick),
    registrations: ({ id, title }) => ({
      sourceCodeRenderers: [{ id, title, component }],
    }),
    optionTitle: (provider) => provider.title,
    useResolvedPluginId: () =>
      resolvedPluginId(useSourceCodeRendererReplacement()),
  },
  {
    name: "diff renderer",
    settingLabel: "Diffs",
    setPick: (store, pick) => store.set(diffRendererProviderAtom, pick),
    registrations: ({ id, title }) => ({
      diffRenderers: [{ id, title, component }],
    }),
    optionTitle: (provider) => provider.title,
    useResolvedPluginId: () => resolvedPluginId(useDiffRendererReplacement()),
  },
  {
    name: "thread header title",
    settingLabel: "Thread header title",
    setPick: (store, pick) => store.set(threadHeaderTitleProviderAtom, pick),
    registrations: ({ id }) => ({ threadHeaderTitles: [{ id, component }] }),
    optionTitle: (provider) => provider.pluginId,
    useResolvedPluginId: () => resolvedPluginId(usePluginThreadHeaderTitle()),
  },
  {
    name: "thread outline",
    settingLabel: "Thread outline",
    setPick: (store, pick) => store.set(threadRailOutlineProviderAtom, pick),
    registrations: ({ id }) => ({ threadRailOutlines: [{ id, component }] }),
    optionTitle: (provider) => provider.pluginId,
    useResolvedPluginId: () => resolvedPluginId(usePluginThreadRailOutline()),
  },
  {
    name: "file opener",
    settingLabel: "Plugin for .md files",
    setPick: (store, pick) => store.set(fileOpenerPreferenceAtom, { md: pick }),
    registrations: ({ id, title }) => ({
      fileOpeners: [{ id, title, extensions: ["md"], component }],
    }),
    optionTitle: (provider) => provider.title,
    useResolvedPluginId: () => {
      const resolved = resolveFileOpenerReplacement({
        registrations: usePluginSlotKind("fileOpeners"),
        picks: useAtomValue(fileOpenerPreferenceAtom),
        path: "README.md",
        boot: useExclusiveBootState(),
      });
      return resolved.kind === "plugin" ? resolved.registration.pluginId : null;
    },
  },
  {
    name: "code fence renderer",
    settingLabel: "Plugin for bash code blocks",
    setPick: (store, pick) => store.set(codeFencePicksAtom, { bash: pick }),
    registrations: ({ id }) => ({
      codeFenceRenderers: [{ id, languages: ["bash"], component }],
    }),
    optionTitle: (provider) => provider.pluginId,
    useResolvedPluginId: () => {
      const resolved = resolveCodeFenceRendererRegistry(
        usePluginSlotKind("codeFenceRenderers"),
        useAtomValue(codeFencePicksAtom),
        useExclusiveBootState(),
      ).get("bash");
      return resolved?.status === "ok" ? resolved.slot.pluginId : null;
    },
  },
];

const BUNDLED = { pluginId: "bundled", id: "main", title: "Bundled provider" };
const INSTALLED = {
  pluginId: "installed",
  id: "main",
  title: "Installed provider",
};
const PINNED = { pluginId: "pinned", id: "main", title: "Pinned provider" };
const ZEBRA = { pluginId: "zebra", id: "main", title: "Zebra provider" };
const OFFICIAL = {
  pluginId: "aaa-official",
  id: "main",
  title: "Official provider",
};
const PINNED_KEY = `${PINNED.pluginId}/${PINNED.id}`;

function register(surface: PinnedSurface, provider: Provider) {
  setPluginSlotRegistrations(
    provider.pluginId,
    makePluginRegistrationSet(surface.registrations(provider)),
  );
}

function setUp(surface: PinnedSurface, pick: string = PINNED_KEY) {
  setBuiltinPluginIds([BUNDLED.pluginId]);
  register(surface, BUNDLED);
  register(surface, INSTALLED);
  const store = createStore();
  surface.setPick(store, pick);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <JotaiProvider store={store}>{children}</JotaiProvider>
    </MemoryRouter>
  );
  const resolved = renderHook(() => surface.useResolvedPluginId(), {
    wrapper,
  });
  render(
    <>
      <PluginSlotChoiceRows />
      <FileOpenerChoicesSection />
      <MarkdownRendererChoicesSection />
    </>,
    { wrapper },
  );
  const settingText = () =>
    screen.getByRole("button", { name: surface.settingLabel }).textContent;
  return { resolved, settingText };
}

afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
  resetPluginFrontendBootStateForTest();
});

describe.each(SURFACES)("exclusive $name", (surface) => {
  it("uses the pinned provider and names it in its Settings row", () => {
    register(surface, PINNED);
    markPluginFrontendsSettled();
    const { resolved, settingText } = setUp(surface);

    expect(resolved.result.current).toBe(PINNED.pluginId);
    expect(settingText()).toContain(surface.optionTitle(PINNED));
  });

  it("behaves as Automatic once plugins settle without the pinned plugin, and Settings says so", () => {
    markPluginFrontendsSettled();
    const { resolved, settingText } = setUp(surface);

    expect(resolved.result.current).toBe(INSTALLED.pluginId);
    expect(settingText()).toContain("Automatic");
  });

  it("ranks installed plugins by id ahead of bundled ones under Automatic", () => {
    register(surface, ZEBRA);
    markPluginFrontendsSettled();
    const { resolved } = setUp(surface, "__automatic__");

    expect(resolved.result.current).toBe(INSTALLED.pluginId);
  });

  it("ranks plugins from bb's official marketplace with bb's bundled ones under Automatic", () => {
    register(surface, OFFICIAL);
    setOfficialMarketplacePluginIds([OFFICIAL.pluginId]);
    markPluginFrontendsSettled();
    const { resolved } = setUp(surface, "__automatic__");

    expect(resolved.result.current).toBe(INSTALLED.pluginId);
  });

  it("keeps behaving as Automatic while plugins reload after boot", () => {
    markPluginFrontendsSettled();
    const { resolved } = setUp(surface);

    act(() => setPluginFrontendReconcilePending(true));
    expect(resolved.result.current).toBe(INSTALLED.pluginId);

    act(() => register(surface, PINNED));
    expect(resolved.result.current).toBe(PINNED.pluginId);
  });

  it("waits for the pinned plugin while plugins are still loading", () => {
    const { resolved } = setUp(surface);

    expect(resolved.result.current).toBeNull();

    act(() => register(surface, PINNED));
    expect(resolved.result.current).toBe(PINNED.pluginId);
  });
});
