// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import {
  MemoryRouter,
  useNavigate,
  type NavigateFunction,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalPageProps } from "@get-bb/plugin-sdk";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { settleLazyModules } from "@/test/lazy-modules";
import {
  getPluginSlotSnapshot,
  removePluginSlotRegistrations,
  setBuiltinPluginIds,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  markPluginFrontendBootStarted,
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import {
  rememberPageOwners,
  resetRememberedPageOwnersForTest,
} from "@/lib/page-owner";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { PageRoute } from "./PageRoute";

const coreMounts = vi.hoisted(() => ({ count: 0, renders: 0 }));

vi.mock("./SplitWorkspaceRoute", async () => {
  const { useEffect: useMountEffect } = await import("react");
  return {
    default: function CoreWorkspaceStub() {
      coreMounts.renders += 1;
      useMountEffect(() => {
        coreMounts.count += 1;
      }, []);
      return <div data-testid="core-workspace" />;
    },
  };
});

const pageMounts = { count: 0 };
const seenLocations: ExperimentalPageProps["location"][] = [];

function ProbePage({ location }: ExperimentalPageProps) {
  useEffect(() => {
    pageMounts.count += 1;
  }, []);
  seenLocations.push(location);
  return (
    <div data-testid="probe-page">
      {location.kind === "thread"
        ? `${location.projectId}/${location.threadId}`
        : "home"}
    </div>
  );
}

function CrashingPage(): never {
  throw new Error("page crashed");
}

function registerPage(
  pluginId: string,
  overrides: Partial<{
    routes: ("home" | "thread")[];
    component: (props: ExperimentalPageProps) => React.ReactNode;
  }> = {},
) {
  setPluginSlotRegistrations(
    pluginId,
    makePluginRegistrationSet({
      pages: [
        {
          id: "shell",
          title: `${pluginId} shell`,
          routes: overrides.routes ?? ["home", "thread"],
          chrome: { sidebar: "hidden" },
          component: overrides.component ?? ProbePage,
        },
      ],
    }),
  );
}

const navigation: { navigate: NavigateFunction | null } = {
  navigate: null,
};
function CaptureNavigate() {
  const navigate = useNavigate();
  useEffect(() => {
    navigation.navigate = navigate;
  }, [navigate]);
  return null;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CaptureNavigate />
      <PageRoute />
    </MemoryRouter>,
  );
}

function settleBoot() {
  act(() => {
    markPluginFrontendBootStarted();
    markPluginFrontendsSettled();
  });
}

beforeEach(() => {
  coreMounts.count = 0;
  coreMounts.renders = 0;
  pageMounts.count = 0;
  seenLocations.length = 0;
  window.localStorage.clear();
  resetRememberedPageOwnersForTest();
  resetPluginFrontendBootStateForTest();
});

afterEach(() => {
  cleanup();
  for (const pluginId of ["chat", "installed-chat", "crashy"]) {
    removePluginSlotRegistrations(pluginId);
  }
  setBuiltinPluginIds([]);
  resetAllCrashedPluginSlotsForTest();
  navigation.navigate = null;
});

describe("PageRoute ownership", () => {
  it("draws bb's workspace on the first render when no plugin is remembered as a page owner", async () => {
    renderAt("/projects/proj_1/threads/thr_1");
    expect(document.querySelector("[data-plugin-page-pending]")).toBeNull();
    await settleLazyModules();
    expect(screen.getByTestId("core-workspace")).toBeTruthy();
  });

  it("does not re-render bb's workspace when plugin boot settles or other slots register", async () => {
    renderAt("/projects/proj_1/threads/thr_1");
    await settleLazyModules();
    const rendersBefore = coreMounts.renders;
    settleBoot();
    act(() =>
      setPluginSlotRegistrations(
        "chat",
        makePluginRegistrationSet({
          settingsSections: [
            { id: "settings", title: "Settings", component: () => null },
          ],
        }),
      ),
    );
    expect(coreMounts.renders).toBe(rendersBefore);
    expect(coreMounts.count).toBe(1);
  });

  it("keeps the pages slot list stable when plugins register other slot kinds", () => {
    const before = getPluginSlotSnapshot().pages;
    setPluginSlotRegistrations(
      "chat",
      makePluginRegistrationSet({
        settingsSections: [
          { id: "settings", title: "Settings", component: () => null },
        ],
      }),
    );
    expect(getPluginSlotSnapshot().pages).toBe(before);
  });

  it("holds a blank page for a remembered owner while plugins boot, never mounting bb's page", async () => {
    registerPage("chat");
    rememberPageOwners(true, getPluginSlotSnapshot().pages);
    removePluginSlotRegistrations("chat");
    resetRememberedPageOwnersForTest();

    renderAt("/");
    await settleLazyModules();
    expect(document.querySelector("[data-plugin-page-pending]")).not.toBeNull();
    expect(coreMounts.count).toBe(0);

    act(() => registerPage("chat"));
    expect(screen.getByTestId("probe-page").textContent).toBe("home");
    await settleLazyModules();
    expect(coreMounts.count).toBe(0);
  });

  it("falls back to bb's page when boot settles without the remembered owner", async () => {
    registerPage("chat");
    rememberPageOwners(true, getPluginSlotSnapshot().pages);
    removePluginSlotRegistrations("chat");
    resetRememberedPageOwnersForTest();

    renderAt("/");
    settleBoot();
    await settleLazyModules();
    expect(screen.getByTestId("core-workspace")).toBeTruthy();
  });

  it.each([
    ["/projects/proj_1/threads/thr_1", "proj_1/thr_1"],
    ["/threads/thr_2", `${PERSONAL_PROJECT_ID}/thr_2`],
    ["/projects/proj_1/threads/thr_1#msg=4", "proj_1/thr_1"],
  ])("draws the owning plugin's page for %s", (path, expected) => {
    registerPage("chat");
    renderAt(path);
    expect(screen.getByTestId("probe-page").textContent).toBe(expected);
  });

  it("keeps one page mounted across home and thread switches", () => {
    registerPage("chat");
    renderAt("/");
    act(() => void navigation.navigate?.("/projects/proj_1/threads/thr_1"));
    act(() => void navigation.navigate?.("/projects/proj_1/threads/thr_2"));
    act(() => void navigation.navigate?.("/threads/thr_3"));
    expect(screen.getByTestId("probe-page").textContent).toBe(
      `${PERSONAL_PROJECT_ID}/thr_3`,
    );
    expect(pageMounts.count).toBe(1);
  });

  it("leaves routes the page does not claim to bb", async () => {
    registerPage("chat", { routes: ["thread"] });
    renderAt("/");
    await settleLazyModules();
    expect(screen.queryByTestId("probe-page")).toBeNull();
    expect(screen.getByTestId("core-workspace")).toBeTruthy();
    act(() => void navigation.navigate?.("/projects/proj_1/threads/thr_1"));
    expect(screen.getByTestId("probe-page")).toBeTruthy();
  });

  it("prefers a page from a plugin the user installed over a bundled one", () => {
    setBuiltinPluginIds(["chat"]);
    registerPage("chat", {
      component: () => <div data-testid="probe-page">bundled</div>,
    });
    registerPage("installed-chat", {
      component: () => <div data-testid="probe-page">installed</div>,
    });
    renderAt("/");
    expect(screen.getByTestId("probe-page").textContent).toBe("installed");
  });

  it("falls back to bb's page when the plugin page crashes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerPage("crashy", { component: CrashingPage });
    renderAt("/projects/proj_1/threads/thr_1");
    await settleLazyModules();
    expect(screen.getByTestId("core-workspace")).toBeTruthy();
  });
});
