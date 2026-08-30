import { useCallback, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes } from "react";
import {
  definePluginApp,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { PluginRpcResult } from "@get-bb/plugin-sdk";
import {
  availableArcActions,
  createArcId,
  createCoalescedAsyncRunner,
  httpPortalHref,
} from "./src/arc-panel-model.js";
import type { arcRpcContract } from "./src/arcs.js";

type Arc = PluginRpcResult<(typeof arcRpcContract)["list"]>[number];
type Project = PluginRpcResult<(typeof arcRpcContract)["projects"]>[number];
type CreateBackend = "fly" | "apple-container";
type ArcSize = "a1.tiny" | "a1.small" | "a1.medium" | "a1.large" | "a1.xxlarge";

const selectClassName =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const inputClassName =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring";
const textareaClassName =
  "min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  intent?: "primary" | "outline" | "destructive";
  compact?: boolean;
}

function ActionButton({
  className = "",
  compact = false,
  intent = "primary",
  ...props
}: ActionButtonProps) {
  const intentClassName =
    intent === "destructive"
      ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
      : intent === "outline"
        ? "border border-input bg-transparent hover:bg-state-hover"
        : "bg-foreground text-background hover:bg-foreground/90";
  return (
    <button
      type="button"
      className={[
        "inline-flex items-center justify-center rounded-md font-medium disabled:pointer-events-none disabled:opacity-50",
        compact ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
        intentClassName,
        className,
      ].join(" ")}
      {...props}
    />
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseCreateBackend(value: string): CreateBackend {
  if (value === "fly" || value === "apple-container") {
    return value;
  }
  throw new Error("Unsupported Arc runtime");
}

function parseArcSize(value: string): ArcSize {
  switch (value) {
    case "a1.tiny":
    case "a1.small":
    case "a1.medium":
    case "a1.large":
    case "a1.xxlarge":
      return value;
    default:
      throw new Error("Unsupported Arc size");
  }
}

function ArcPanel() {
  const rpc = useRpc<typeof arcRpcContract>();
  const context = useBbContext();
  const navigate = useBbNavigate();
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  const [arcs, setArcs] = useState<Arc[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [account, setAccount] = useState<
    "unknown" | "connected" | "disconnected"
  >("unknown");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(context.projectId ?? "");
  const [prompt, setPrompt] = useState("");
  const [backend, setBackend] = useState<CreateBackend>("fly");
  const [size, setSize] = useState<ArcSize>("a1.small");
  const [displayName, setDisplayName] = useState("Arc");
  const [pendingCreateArcId, setPendingCreateArcId] = useState(createArcId);
  const [confirmDestroyArcId, setConfirmDestroyArcId] = useState<string | null>(
    null,
  );
  const [remoteProvider, setRemoteProvider] = useState("");
  const [overviewRefresh] = useState(createCoalescedAsyncRunner);
  const selectedProject = projects.find((project) => project.id === projectId);
  const target = {
    providerId: "acp-rift",
    ...(selectedProject === undefined
      ? {}
      : { hostId: selectedProject.hostId, cwd: selectedProject.cwd }),
  } as const;

  const refreshArcs = useCallback(
    () =>
      overviewRefresh.run(async () => {
        try {
          const overview = await rpc.call("overview", target);
          setArcs(overview.arcs);
          setAccount(overview.account.state);
          setError(null);
        } catch (loadError) {
          setError(message(loadError));
        }
      }),
    [overviewRefresh, rpc, selectedProject?.cwd, selectedProject?.hostId],
  );

  useEffect(() => {
    let current = true;
    void rpc
      .call("projects", {})
      .then((availableProjects) => {
        if (!current) {
          return;
        }
        setProjects(availableProjects);
        setProjectId(
          (selected) =>
            selected || context.projectId || availableProjects[0]?.id || "",
        );
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(message(loadError));
        }
      });
    return () => {
      current = false;
    };
  }, [context.projectId, rpc]);

  useEffect(() => {
    void refreshArcs();
  }, [refreshArcs]);

  useEffect(() => {
    const reconnected =
      connection === "connected" && previousConnection.current !== "connected";
    previousConnection.current = connection;
    if (reconnected) {
      void refreshArcs();
    }
  }, [connection, refreshArcs]);

  useEffect(() => {
    const refreshOnFocus = () => {
      void refreshArcs();
    };
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshArcs();
      }
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [refreshArcs]);

  useRealtime(
    "arcs-changed",
    useCallback(() => {
      void refreshArcs();
    }, [refreshArcs]),
  );

  const mutate = async (
    arcId: string,
    action: "start" | "pause" | "stop" | "destroy",
  ) => {
    setBusy(action + ":" + arcId);
    setError(null);
    try {
      await rpc.call(
        action === "destroy" ? "destroy" : "lifecycle",
        action === "destroy"
          ? { ...target, arcId }
          : { ...target, arcId, action },
      );
      await refreshArcs();
    } catch (mutationError) {
      setError(message(mutationError));
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    setBusy("create");
    setError(null);
    try {
      await rpc.call("create", {
        ...target,
        arcId: pendingCreateArcId,
        backend,
        size,
        workspaceRoot: "/work",
        displayName: displayName.trim() || "Arc",
        image: "",
        ...(backend === "fly" && remoteProvider
          ? { provider: remoteProvider }
          : {}),
      });
      setPendingCreateArcId(createArcId());
      await refreshArcs();
    } catch (createError) {
      setError(message(createError));
    } finally {
      setBusy(null);
    }
  };

  const authorize = async () => {
    setBusy("authorize");
    setError(null);
    try {
      const status = await rpc.call("authorize", target);
      setAccount(status.state);
      if (status.state === "connected") await refreshArcs();
    } catch (authorizationError) {
      setError(message(authorizationError));
    } finally {
      setBusy(null);
    }
  };

  const spawn = async (arcId: string) => {
    if (!projectId || !prompt.trim()) {
      setError("Choose a project and enter a prompt to start a thread.");
      return;
    }
    setBusy("thread:" + arcId);
    setError(null);
    try {
      const result = await rpc.call("spawnThread", {
        providerId: "acp-rift",
        arcId,
        projectId,
        prompt: prompt.trim(),
      });
      navigate.toThread(result.threadId);
    } catch (spawnError) {
      setError(message(spawnError));
      setBusy(null);
    }
  };

  const threadInputs = (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm">
        Project
        <select
          className={selectClassName}
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">Choose a project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Prompt
        <textarea
          className={textareaClassName}
          placeholder="What should Rift work on?"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
    </div>
  );

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Arcs</h2>
          <p className="text-sm text-muted-foreground">
            Run Rift threads on this host, Apple Container, or a remote
            provider.
          </p>
        </div>
        <ActionButton
          compact
          intent="outline"
          disabled={busy !== null}
          onClick={() => void refreshArcs()}
        >
          Refresh
        </ActionButton>
      </div>

      {error ? (
        <p
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {account === "disconnected" ? (
        <section className="space-y-3 rounded-md border border-border p-4">
          <div>
            <h3 className="font-medium">Connect Rift</h3>
            <p className="text-sm text-muted-foreground">
              Open Rift&apos;s secure account authorization in this BB client.
            </p>
          </div>
          <ActionButton
            disabled={busy !== null}
            onClick={() => void authorize()}
          >
            Connect Rift
          </ActionButton>
        </section>
      ) : null}

      {account === "connected" ? (
        <>
          <section className="space-y-3 rounded-md border border-border p-4">
            <div>
              <h3 className="font-medium">Create an Arc</h3>
              <p className="text-sm text-muted-foreground">
                Local and remote Arcs use the same lifecycle.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                Name
                <input
                  className={inputClassName}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm">
                Runtime
                <select
                  className={selectClassName}
                  value={backend}
                  onChange={(event) =>
                    setBackend(parseCreateBackend(event.target.value))
                  }
                >
                  <option value="fly">Remote</option>
                  <option value="apple-container">Apple Container</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                Size
                <select
                  className={selectClassName}
                  value={size}
                  onChange={(event) =>
                    setSize(parseArcSize(event.target.value))
                  }
                >
                  <option value="a1.tiny">Tiny</option>
                  <option value="a1.small">Small</option>
                  <option value="a1.medium">Medium</option>
                  <option value="a1.large">Large</option>
                  <option value="a1.xxlarge">Extra large</option>
                </select>
              </label>
              {backend === "fly" ? (
                <label className="grid gap-1 text-sm">
                  Remote provider
                  <select
                    className={selectClassName}
                    value={remoteProvider}
                    onChange={(event) => setRemoteProvider(event.target.value)}
                  >
                    <option value="">Workspace default</option>
                    <option value="machines">Machines</option>
                    <option value="sprites">Sprites</option>
                  </select>
                </label>
              ) : null}
            </div>
            <ActionButton
              disabled={busy !== null}
              onClick={() => void create()}
            >
              Create Arc
            </ActionButton>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="font-medium">Start a thread</h3>
              <p className="text-sm text-muted-foreground">
                Choose a project and prompt, then select an Arc below.
              </p>
            </div>
            {threadInputs}
          </section>

          <section className="grid gap-3">
            {arcs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Arcs found.</p>
            ) : (
              arcs.map((arc) => {
                const actions = availableArcActions(
                  arc.status,
                  arc.capabilities,
                );
                return (
                  <div
                    className="space-y-3 rounded-md border border-border p-4"
                    key={arc.arcId}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {arc.displayName ?? arc.arcId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {arc.backend} · {arc.size ?? "default"} · {arc.status}
                        </p>
                        {arc.errorMessage ? (
                          <p className="mt-1 text-xs text-destructive">
                            {arc.errorMessage}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {actions.start ? (
                          <ActionButton
                            compact
                            intent="outline"
                            disabled={busy !== null}
                            onClick={() => void mutate(arc.arcId, "start")}
                          >
                            Start
                          </ActionButton>
                        ) : null}
                        {actions.pause ? (
                          <ActionButton
                            compact
                            intent="outline"
                            disabled={busy !== null}
                            onClick={() => void mutate(arc.arcId, "pause")}
                          >
                            Pause
                          </ActionButton>
                        ) : null}
                        {actions.stop ? (
                          <ActionButton
                            compact
                            intent="outline"
                            disabled={busy !== null}
                            onClick={() => void mutate(arc.arcId, "stop")}
                          >
                            Stop
                          </ActionButton>
                        ) : null}
                        {actions.destroy ? (
                          <ActionButton
                            compact
                            intent="destructive"
                            disabled={busy !== null}
                            onClick={() => {
                              if (confirmDestroyArcId === arc.arcId) {
                                setConfirmDestroyArcId(null);
                                void mutate(arc.arcId, "destroy");
                                return;
                              }
                              setConfirmDestroyArcId(arc.arcId);
                            }}
                          >
                            {confirmDestroyArcId === arc.arcId
                              ? "Confirm destroy"
                              : "Destroy"}
                          </ActionButton>
                        ) : null}
                      </div>
                    </div>
                    {arc.capabilities.portals
                      ? arc.portals?.map((portal) => {
                          const href = httpPortalHref(portal.url);
                          return href === null ? null : (
                            <a
                              className="block text-sm text-primary underline"
                              href={href}
                              key={`${portal.name}:${href}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {portal.name}
                            </a>
                          );
                        })
                      : null}
                    <ActionButton
                      compact
                      disabled={busy !== null || arc.status !== "ready"}
                      onClick={() => void spawn(arc.arcId)}
                    >
                      New thread on this Arc
                    </ActionButton>
                  </div>
                );
              })
            )}
          </section>
        </>
      ) : null}

      {account === "unknown" && error === null ? (
        <p className="text-sm text-muted-foreground">Loading Arcs…</p>
      ) : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "arcs",
    title: "Arcs",
    icon: "Boxes",
    path: "arcs",
    component: ArcPanel,
  });
});
