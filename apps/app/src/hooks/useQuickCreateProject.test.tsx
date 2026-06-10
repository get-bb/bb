// @vitest-environment jsdom

import { Suspense, useEffect, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import type { Host } from "@bb/domain";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import {
  createProjectRequestSchema,
  type CreateProjectRequest,
} from "@bb/server-contract";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { afterEach, describe, expect, it, vi } from "vitest";

type HostOverrides = Partial<Host>;

interface QuickCreateFetchState {
  daemonConnected: boolean;
  hostDaemonPort: number | null;
  hosts: Host[];
}

interface SuspenseWrapperProps {
  children: ReactNode;
}

interface SuspenseWrapperArgs {
  initialEntry?: string;
  onPathname?: (pathname: string) => void;
}

type QuickCreateProjectSnapshot = ReturnType<
  typeof import("./useQuickCreateProject").useQuickCreateProject
>;
type UseRootComposeProjectIdHook =
  typeof import("@/lib/root-compose-selection").useRootComposeProjectId;

interface QuickCreateProjectCaptureProps {
  onSnapshot: (snapshot: QuickCreateProjectSnapshot) => void;
  useQuickCreateProject: typeof import("./useQuickCreateProject").useQuickCreateProject;
}

interface RootComposeProjectCaptureProps {
  onProjectId: (projectId: string) => void;
  useRootComposeProjectId: UseRootComposeProjectIdHook;
}

function makeHost(overrides: HostOverrides = {}): Host {
  return {
    createdAt: 1,
    id: "host-1",
    lastSeenAt: 1,
    name: "Local Host",
    status: "connected",
    type: "persistent",
    updatedAt: 1,
    ...overrides,
  };
}

function createSuspenseWrapper() {
  return createRoutedSuspenseWrapper({});
}

function createRoutedSuspenseWrapper(args: SuspenseWrapperArgs) {
  const { wrapper: baseWrapper } = createQueryClientTestHarness();

  return ({ children }: SuspenseWrapperProps) =>
    baseWrapper({
      children: (
        <MemoryRouter initialEntries={[args.initialEntry ?? "/"]}>
          {args.onPathname ? (
            <LocationCapture onPathname={args.onPathname} />
          ) : null}
          <Suspense fallback={null}>{children}</Suspense>
        </MemoryRouter>
      ),
    });
}

interface LocationCaptureProps {
  onPathname: (pathname: string) => void;
}

function LocationCapture({ onPathname }: LocationCaptureProps) {
  const location = useLocation();

  useEffect(() => {
    onPathname(location.pathname);
  }, [location.pathname, onPathname]);

  return null;
}

function BackButton() {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => {
        void navigate(-1);
      }}
    >
      Go back
    </button>
  );
}

function QuickCreateProjectCapture({
  onSnapshot,
  useQuickCreateProject,
}: QuickCreateProjectCaptureProps) {
  const snapshot = useQuickCreateProject();

  useEffect(() => {
    onSnapshot(snapshot);
  }, [onSnapshot, snapshot]);

  return null;
}

function RootComposeProjectCapture({
  onProjectId,
  useRootComposeProjectId,
}: RootComposeProjectCaptureProps) {
  const [projectId] = useRootComposeProjectId();

  useEffect(() => {
    onProjectId(projectId);
  }, [onProjectId, projectId]);

  return null;
}

function requireQuickCreateProjectSnapshot(
  snapshot: QuickCreateProjectSnapshot | null,
): QuickCreateProjectSnapshot {
  if (!snapshot) {
    throw new Error("Expected quick-create project hook snapshot.");
  }
  return snapshot;
}

function installQuickCreateFetchRoutes(
  state: QuickCreateFetchState,
  createdProjectRequests: CreateProjectRequest[],
) {
  installFetchRoutes([
    {
      pathname: "/api/v1/system/config",
      handler: async () =>
        jsonResponse({
          hostDaemonPort: state.hostDaemonPort,
          voiceTranscriptionEnabled: false,
        }),
    },
    {
      pathname: "/api/v1/hosts",
      handler: async () => jsonResponse(state.hosts),
    },
    {
      pathname: "/status",
      port: 4123,
      handler: async () =>
        state.daemonConnected
          ? jsonResponse({
              connected: true,
              hostId: "host-1",
              protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
              serverUrl: "http://localhost:3334",
              supportsNativeFolderPicker: false,
              platform: "linux",
            })
          : new Response(null, { status: 503 }),
    },
    {
      method: "POST",
      pathname: "/api/v1/projects",
      handler: async (request) => {
        createdProjectRequests.push(
          createProjectRequestSchema.parse(await request.json()),
        );

        return jsonResponse({
          createdAt: 1,
          id: "proj-1",
          name: "demo",
          sources: [],
          updatedAt: 1,
        });
      },
    },
  ]);
}

async function importFreshUseQuickCreateProject(): Promise<
  typeof import("./useQuickCreateProject")
> {
  vi.resetModules();
  return import("./useQuickCreateProject");
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useQuickCreateProject", () => {
  it("opens a path dialog whenever a local host is available", async () => {
    installQuickCreateFetchRoutes(
      {
        daemonConnected: true,
        hostDaemonPort: 4123,
        hosts: [makeHost()],
      },
      [],
    );

    const { useQuickCreateProject } = await importFreshUseQuickCreateProject();
    const latestSnapshot: { current: QuickCreateProjectSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <QuickCreateProjectCapture
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useQuickCreateProject={useQuickCreateProject}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireQuickCreateProjectSnapshot(latestSnapshot.current).isAvailable,
      ).toBe(true);
    });

    act(() => {
      requireQuickCreateProjectSnapshot(
        latestSnapshot.current,
      ).openCreateDialog();
    });

    expect(
      requireQuickCreateProjectSnapshot(latestSnapshot.current)
        .projectPathDialog.target,
    ).toEqual({ kind: "create" });
  });

  it("creates a project from the submitted absolute path, closes the dialog, and stays on root compose", async () => {
    const createdProjectRequests: CreateProjectRequest[] = [];
    const pathnames: string[] = [];
    installQuickCreateFetchRoutes(
      {
        daemonConnected: true,
        hostDaemonPort: 4123,
        hosts: [makeHost()],
      },
      createdProjectRequests,
    );

    const { useQuickCreateProject } = await importFreshUseQuickCreateProject();
    const { useRootComposeProjectId } = await import(
      "@/lib/root-compose-selection"
    );
    const latestSnapshot: { current: QuickCreateProjectSnapshot | null } = {
      current: null,
    };
    const activeRootComposeProjectIds: string[] = [];
    await act(async () => {
      render(
        <>
          <QuickCreateProjectCapture
            onSnapshot={(snapshot) => {
              latestSnapshot.current = snapshot;
            }}
            useQuickCreateProject={useQuickCreateProject}
          />
          <RootComposeProjectCapture
            onProjectId={(projectId) => {
              activeRootComposeProjectIds.push(projectId);
            }}
            useRootComposeProjectId={useRootComposeProjectId}
          />
          <BackButton />
        </>,
        {
          wrapper: createRoutedSuspenseWrapper({
            onPathname: (pathname) => {
              pathnames.push(pathname);
            },
          }),
        },
      );
    });

    await waitFor(() => {
      expect(
        requireQuickCreateProjectSnapshot(latestSnapshot.current).isAvailable,
      ).toBe(true);
    });

    act(() => {
      requireQuickCreateProjectSnapshot(
        latestSnapshot.current,
      ).openCreateDialog();
    });

    act(() => {
      requireQuickCreateProjectSnapshot(
        latestSnapshot.current,
      ).submitProjectPath({ kind: "create" }, "/srv/repos/demo");
    });

    await waitFor(() => {
      expect(createdProjectRequests).toHaveLength(1);
    });

    expect(createdProjectRequests[0]).toEqual({
      name: "demo",
      source: {
        hostId: "host-1",
        path: "/srv/repos/demo",
        type: "local_path",
      },
    });
    await waitFor(() => {
      expect(
        requireQuickCreateProjectSnapshot(latestSnapshot.current)
          .projectPathDialog.isOpen,
      ).toBe(false);
    });
    await waitFor(() => {
      expect(pathnames.at(-1)).toBe("/");
    });
    await waitFor(() => {
      expect(activeRootComposeProjectIds.at(-1)).toBe("proj-1");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    });

    expect(pathnames.at(-1)).toBe("/");
  });

  it("pushes root compose navigation from non-root routes so back returns to the previous route", async () => {
    const createdProjectRequests: CreateProjectRequest[] = [];
    const pathnames: string[] = [];
    installQuickCreateFetchRoutes(
      {
        daemonConnected: true,
        hostDaemonPort: 4123,
        hosts: [makeHost()],
      },
      createdProjectRequests,
    );

    const { useQuickCreateProject } = await importFreshUseQuickCreateProject();
    const { useRootComposeProjectId } = await import(
      "@/lib/root-compose-selection"
    );
    const latestSnapshot: { current: QuickCreateProjectSnapshot | null } = {
      current: null,
    };
    const activeRootComposeProjectIds: string[] = [];
    await act(async () => {
      render(
        <>
          <QuickCreateProjectCapture
            onSnapshot={(snapshot) => {
              latestSnapshot.current = snapshot;
            }}
            useQuickCreateProject={useQuickCreateProject}
          />
          <RootComposeProjectCapture
            onProjectId={(projectId) => {
              activeRootComposeProjectIds.push(projectId);
            }}
            useRootComposeProjectId={useRootComposeProjectId}
          />
          <BackButton />
        </>,
        {
          wrapper: createRoutedSuspenseWrapper({
            initialEntry: "/projects/proj-existing",
            onPathname: (pathname) => {
              pathnames.push(pathname);
            },
          }),
        },
      );
    });

    await waitFor(() => {
      expect(
        requireQuickCreateProjectSnapshot(latestSnapshot.current).isAvailable,
      ).toBe(true);
    });

    act(() => {
      requireQuickCreateProjectSnapshot(
        latestSnapshot.current,
      ).submitProjectPath({ kind: "create" }, "/srv/repos/demo");
    });

    await waitFor(() => {
      expect(createdProjectRequests).toHaveLength(1);
    });
    await waitFor(() => {
      expect(pathnames.at(-1)).toBe("/");
    });
    await waitFor(() => {
      expect(activeRootComposeProjectIds.at(-1)).toBe("proj-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    await waitFor(() => {
      expect(pathnames.at(-1)).toBe("/projects/proj-existing");
    });
  });

  it("falls back to the connected primary host when the local daemon is unreachable", async () => {
    const createdProjectRequests: CreateProjectRequest[] = [];
    installQuickCreateFetchRoutes(
      {
        daemonConnected: false,
        hostDaemonPort: null,
        hosts: [makeHost({ id: "host-remote", name: "Remote Host" })],
      },
      createdProjectRequests,
    );

    const { useQuickCreateProject } = await importFreshUseQuickCreateProject();
    const latestSnapshot: { current: QuickCreateProjectSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <QuickCreateProjectCapture
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useQuickCreateProject={useQuickCreateProject}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireQuickCreateProjectSnapshot(latestSnapshot.current).isAvailable,
      ).toBe(true);
    });
    expect(
      requireQuickCreateProjectSnapshot(latestSnapshot.current).hostName,
    ).toBe("Remote Host");

    act(() => {
      requireQuickCreateProjectSnapshot(
        latestSnapshot.current,
      ).openCreateDialog();
    });

    expect(
      requireQuickCreateProjectSnapshot(latestSnapshot.current)
        .projectPathDialog.target,
    ).toEqual({ kind: "create" });

    act(() => {
      requireQuickCreateProjectSnapshot(
        latestSnapshot.current,
      ).submitProjectPath({ kind: "create" }, "/srv/repos/demo");
    });

    await waitFor(() => {
      expect(createdProjectRequests).toHaveLength(1);
    });
    expect(createdProjectRequests[0]).toEqual({
      name: "demo",
      source: {
        hostId: "host-remote",
        path: "/srv/repos/demo",
        type: "local_path",
      },
    });
  });

  it("stays unavailable when the only known host is disconnected", async () => {
    installQuickCreateFetchRoutes(
      {
        daemonConnected: false,
        hostDaemonPort: null,
        hosts: [makeHost({ status: "disconnected" })],
      },
      [],
    );

    const { useQuickCreateProject } = await importFreshUseQuickCreateProject();
    const latestSnapshot: { current: QuickCreateProjectSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <QuickCreateProjectCapture
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useQuickCreateProject={useQuickCreateProject}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(latestSnapshot.current).not.toBeNull();
    });
    expect(
      requireQuickCreateProjectSnapshot(latestSnapshot.current).isAvailable,
    ).toBe(false);
  });

  it("does not open the create dialog when no local host is available", async () => {
    installQuickCreateFetchRoutes(
      {
        daemonConnected: false,
        hostDaemonPort: null,
        hosts: [],
      },
      [],
    );

    const { useQuickCreateProject } = await importFreshUseQuickCreateProject();
    const latestSnapshot: { current: QuickCreateProjectSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <QuickCreateProjectCapture
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useQuickCreateProject={useQuickCreateProject}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireQuickCreateProjectSnapshot(latestSnapshot.current).isAvailable,
      ).toBe(false);
    });

    act(() => {
      requireQuickCreateProjectSnapshot(
        latestSnapshot.current,
      ).openCreateDialog();
    });

    expect(
      requireQuickCreateProjectSnapshot(latestSnapshot.current)
        .projectPathDialog.target,
    ).toBeNull();
  });

});
