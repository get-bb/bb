// @vitest-environment jsdom

import type { ComponentType, ReactNode } from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import {
  createStore,
  Provider as JotaiProvider,
  type WritableAtom,
} from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffRendererProviderAtom,
  sourceCodeRendererProviderAtom,
  useDiffRendererReplacement,
  useSourceCodeRendererReplacement,
} from "@/components/code/codeRendererProvider";
import {
  composerRendererProviderAtom,
  useComposerReplacement,
} from "@/components/promptbox/composer-provider";
import { CodeRendererSettings } from "@/components/settings/CodeRendererSettings";
import { SidebarNavigationProviderSetting } from "@/components/settings/SidebarNavigationProviderSetting";
import { SidebarThreadListSetting } from "@/components/settings/SidebarThreadListSetting";
import {
  sidebarNavigationProviderAtom,
  useResolvedSidebarNavigation,
} from "@/components/sidebar/sidebarNavigationProvider";
import {
  threadListProviderAtom,
  useThreadListReplacement,
} from "@/components/sidebar/threadListProvider";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
  setPluginFrontendReconcilePending,
} from "@/lib/plugin-frontend-boot-state";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import {
  resetPluginSlotStoreForTest,
  setBuiltinPluginIds,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

interface Provider {
  id: string;
  title: string;
}

interface PinnedReplacementSurface {
  name: string;
  settingLabel: string;
  preferenceAtom: WritableAtom<string, [string], void>;
  Settings: ComponentType;
  registrations: (provider: Provider) => Partial<PluginRegistrationSet>;
  useResolvedTitle: () => string | null;
}

function replacementTitle(
  resolved: ResolvedReplacement<{ title: string }>,
): string | null {
  return resolved.kind === "plugin" ? resolved.registration.title : null;
}

const component = () => null;

const SURFACES: PinnedReplacementSurface[] = [
  {
    name: "composer",
    settingLabel: "Composer",
    preferenceAtom: composerRendererProviderAtom,
    Settings: CodeRendererSettings,
    registrations: (provider) => ({ composers: [{ ...provider, component }] }),
    useResolvedTitle: () => replacementTitle(useComposerReplacement()),
  },
  {
    name: "thread list",
    settingLabel: "Sidebar thread list",
    preferenceAtom: threadListProviderAtom,
    Settings: SidebarThreadListSetting,
    registrations: (provider) => ({
      threadLists: [{ ...provider, component }],
    }),
    useResolvedTitle: () => replacementTitle(useThreadListReplacement()),
  },
  {
    name: "sidebar navigation",
    settingLabel: "Sidebar navigation",
    preferenceAtom: sidebarNavigationProviderAtom,
    Settings: SidebarNavigationProviderSetting,
    registrations: (provider) => ({
      experimentalSidebarNavigations: [
        { ...provider, placement: "rail", component },
      ],
    }),
    useResolvedTitle: () => {
      const resolved = useResolvedSidebarNavigation();
      return resolved.kind === "plugin" ? resolved.slot.title : null;
    },
  },
  {
    name: "source code renderer",
    settingLabel: "Source code",
    preferenceAtom: sourceCodeRendererProviderAtom,
    Settings: CodeRendererSettings,
    registrations: (provider) => ({
      sourceCodeRenderers: [{ ...provider, component }],
    }),
    useResolvedTitle: () =>
      replacementTitle(useSourceCodeRendererReplacement()),
  },
  {
    name: "diff renderer",
    settingLabel: "Diffs",
    preferenceAtom: diffRendererProviderAtom,
    Settings: CodeRendererSettings,
    registrations: (provider) => ({
      diffRenderers: [{ ...provider, component }],
    }),
    useResolvedTitle: () => replacementTitle(useDiffRendererReplacement()),
  },
];

const BUNDLED = { pluginId: "bundled", id: "main", title: "Bundled provider" };
const INSTALLED = {
  pluginId: "installed",
  id: "main",
  title: "Installed provider",
};
const PINNED = { pluginId: "pinned", id: "main", title: "Pinned provider" };
const PINNED_KEY = `${PINNED.pluginId}/${PINNED.id}`;

function register(
  surface: PinnedReplacementSurface,
  { pluginId, id, title }: typeof BUNDLED,
) {
  setPluginSlotRegistrations(
    pluginId,
    makePluginRegistrationSet(surface.registrations({ id, title })),
  );
}

function setUp(surface: PinnedReplacementSurface) {
  setBuiltinPluginIds([BUNDLED.pluginId]);
  register(surface, BUNDLED);
  register(surface, INSTALLED);
  const store = createStore();
  store.set(surface.preferenceAtom, PINNED_KEY);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider store={store}>{children}</JotaiProvider>
  );
  const resolved = renderHook(() => surface.useResolvedTitle(), { wrapper });
  render(<surface.Settings />, { wrapper });
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

describe.each(SURFACES)("pinned $name", (surface) => {
  it("uses the pinned provider and names it in Settings", () => {
    register(surface, PINNED);
    markPluginFrontendsSettled();
    const { resolved, settingText } = setUp(surface);

    expect(resolved.result.current).toBe(PINNED.title);
    expect(settingText()).toContain(PINNED.title);
  });

  it("behaves as Automatic once plugins settle without the pinned plugin, and Settings says so", () => {
    markPluginFrontendsSettled();
    const { resolved, settingText } = setUp(surface);

    expect(resolved.result.current).toBe(INSTALLED.title);
    expect(settingText()).toContain("Automatic");
  });

  it("keeps behaving as Automatic while plugins reload after boot", () => {
    markPluginFrontendsSettled();
    const { resolved } = setUp(surface);

    act(() => setPluginFrontendReconcilePending(true));
    expect(resolved.result.current).toBe(INSTALLED.title);

    act(() => register(surface, PINNED));
    expect(resolved.result.current).toBe(PINNED.title);
  });

  it("waits for the pinned plugin while plugins are still loading", () => {
    const { resolved } = setUp(surface);

    expect(resolved.result.current).toBeNull();

    act(() => register(surface, PINNED));
    expect(resolved.result.current).toBe(PINNED.title);
  });
});
