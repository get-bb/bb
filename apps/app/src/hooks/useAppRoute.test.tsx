// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { useAppRoute, type AppRouteState } from "./useAppRoute";

interface RouteCaptureProps {
  onRoute: (route: AppRouteState) => void;
}

interface RenderRouteCaptureArgs {
  initialEntry: string;
}

function RouteCapture({ onRoute }: RouteCaptureProps) {
  const route = useAppRoute();
  onRoute(route);
  return <div data-testid="thread-id">{route.threadId ?? ""}</div>;
}

function renderRouteCapture(args: RenderRouteCaptureArgs): AppRouteState {
  let capturedRoute: AppRouteState | null = null;
  render(
    <MemoryRouter initialEntries={[args.initialEntry]}>
      <RouteCapture
        onRoute={(route) => {
          capturedRoute = route;
        }}
      />
    </MemoryRouter>,
  );
  expect(screen.getByTestId("thread-id")).toBeTruthy();
  if (capturedRoute === null) {
    throw new Error("route was not captured");
  }
  return capturedRoute;
}

afterEach(() => {
  cleanup();
});

describe("useAppRoute", () => {
  it("treats root as the compose surface", () => {
    const route = renderRouteCapture({ initialEntry: "/" });

    expect(route.projectId).toBeUndefined();
    expect(route.threadId).toBeUndefined();
    expect(route.isRootView).toBe(true);
    expect(route.isProjectlessView).toBe(true);
  });

  it("keeps legacy project compose redirects project scoped", () => {
    const route = renderRouteCapture({
      initialEntry: "/projects/proj_standard",
    });

    expect(route.projectId).toBe("proj_standard");
    expect(route.threadId).toBeUndefined();
    expect(route.isThreadView).toBe(false);
    expect(route.isProjectlessView).toBe(false);
  });

  it("maps canonical projectless thread URLs to the personal project", () => {
    const route = renderRouteCapture({
      initialEntry: "/threads/thr_personal",
    });

    expect(route.projectId).toBe(PERSONAL_PROJECT_ID);
    expect(route.threadId).toBe("thr_personal");
    expect(route.isThreadView).toBe(true);
    expect(route.isProjectlessView).toBe(true);
  });

  it("keeps standard project thread routes project scoped", () => {
    const route = renderRouteCapture({
      initialEntry: "/projects/proj_standard/threads/thr_standard",
    });

    expect(route.projectId).toBe("proj_standard");
    expect(route.threadId).toBe("thr_standard");
    expect(route.isThreadView).toBe(true);
    expect(route.isProjectlessView).toBe(false);
  });

  it("recognizes the standalone app route", () => {
    const route = renderRouteCapture({ initialEntry: "/apps/alpha" });

    expect(route.applicationId).toBe("alpha");
    expect(route.isAppView).toBe(true);
    expect(route.threadId).toBeUndefined();
    expect(route.projectId).toBeUndefined();
    expect(route.isThreadView).toBe(false);
  });

  it("recognizes the projectless workflow-run page", () => {
    const route = renderRouteCapture({
      initialEntry: "/workflows/runs/wfr_abc123",
    });

    expect(route.workflowRunId).toBe("wfr_abc123");
    expect(route.isWorkflowRunView).toBe(true);
    expect(route.projectId).toBeUndefined();
    expect(route.threadId).toBeUndefined();
    expect(route.isWorkflowsView).toBe(false);
  });

  it("recognizes the workflow-run agent drill-in sub-route", () => {
    const route = renderRouteCapture({
      initialEntry: "/workflows/runs/wfr_abc123/agents/2",
    });

    expect(route.workflowRunId).toBe("wfr_abc123");
    expect(route.isWorkflowRunView).toBe(true);
    expect(route.projectId).toBeUndefined();
    expect(route.threadId).toBeUndefined();
  });

  it("does not accept personal project thread routes", () => {
    const route = renderRouteCapture({
      initialEntry: `/projects/${PERSONAL_PROJECT_ID}/threads/thr_personal`,
    });

    expect(route.projectId).toBeUndefined();
    expect(route.threadId).toBeUndefined();
    expect(route.isThreadView).toBe(false);
    expect(route.isProjectlessView).toBe(false);
  });
});
