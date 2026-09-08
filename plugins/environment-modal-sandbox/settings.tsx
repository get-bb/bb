import { useCallback, useEffect, useState } from "react";
import { useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import type { modalRpcContract } from "./catalogue/contract.js";
import type {
  Build,
  Project,
  Recipe,
  Verification,
} from "./catalogue/model.js";
import type { inspectionSchema } from "./catalogue/source-contract.js";
import type { z } from "zod";
import { RecipeEditor } from "./recipe-editor.js";
import {
  errorText,
  runningHourlyEstimate,
  stalenessLabel,
  type Staleness,
} from "./ui-state.js";

type Rpc = ReturnType<typeof useRpc<typeof modalRpcContract>>;
type ProjectState = Project & { staleness: Staleness };
type Source = {
  id: string;
  hostId: string;
  path: string;
  name: string;
  primaryHost: boolean;
};

export function ModalSettings() {
  const rpc = useRpc<typeof modalRpcContract>();
  const context = useBbContext();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState(context.projectId ?? "");
  const [account, setAccount] = useState("");
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    let live = true;
    void rpc
      .call("catalogue.projects", {})
      .then((value) => {
        if (live) setProjects(value);
      })
      .catch((error) => {
        if (live) setMessage(errorText(error));
      });
    return () => {
      live = false;
    };
  }, [rpc]);
  async function checkAccount() {
    setChecking(true);
    try {
      const value = await rpc.call("account.inspect", {});
      setAccount(
        `${value.message}${value.appName ? ` · app ${value.appName}` : ""}${value.accountIdentity ? ` · account ${value.accountIdentity.slice(0, 12)}` : ""} · base ${value.baseVersion}`,
      );
    } catch (error) {
      setAccount(errorText(error));
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-6 text-sm">
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Account and project images</h3>
        <p className="text-xs text-muted-foreground">
          Configure the secret token and app above. Existing machines stay
          pinned to their original account and image.
        </p>
        <Button
          variant="outline"
          className="self-start"
          disabled={checking}
          onClick={() => void checkAccount()}
        >
          {checking ? "Checking…" : "Test connection"}
        </Button>
        {account && (
          <p role="status" className="break-words text-xs">
            {account}
          </p>
        )}
      </section>
      <label className="flex flex-col gap-1.5">
        Project
        <select
          aria-label="Modal project"
          className="rounded-md border border-border bg-background p-2"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">Select a project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      {message && <p role="alert">{message}</p>}
      {projectId && (
        <ProjectCatalogue key={projectId} projectId={projectId} rpc={rpc} />
      )}
      <a className="text-xs underline" href="/settings/machines">
        View existing machines and lifecycle controls
      </a>
    </div>
  );
}

function ProjectCatalogue({ projectId, rpc }: { projectId: string; rpc: Rpc }) {
  const [draftDirty, setDraftDirty] = useState(false);
  const [project, setProject] = useState<ProjectState | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [inspection, setInspection] = useState<z.infer<
    typeof inspectionSchema
  > | null>(null);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [images, setImages] = useState<Build[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [provider, setProvider] = useState("codex");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const [nextProject, nextImages] = await Promise.all([
      rpc.call("project.show", { projectId }),
      rpc.call("image.list", { projectId, cursor: null, limit: 50 }),
    ]);
    setProject(nextProject);
    setImages(nextImages.images);
    setCursor(nextImages.nextCursor);
  }, [rpc, projectId]);
  useEffect(() => {
    let live = true;
    void Promise.all([
      rpc.call("project.show", { projectId }),
      rpc.call("recipe.get", { projectId }).catch(() => null),
      rpc.call("project.sources", { projectId }),
      rpc.call("image.list", { projectId, cursor: null, limit: 50 }),
    ])
      .then(([nextProject, nextRecipe, nextSources, nextImages]) => {
        if (!live) return;
        setProject(nextProject);
        setRecipe(nextRecipe);
        setSources(nextSources);
        setImages(nextImages.images);
        setCursor(nextImages.nextCursor);
        setSourceId(nextSources.find((source) => source.primaryHost)?.id ?? "");
        setLoaded(true);
      })
      .catch((error) => {
        if (live) setMessage(errorText(error));
      });
    return () => {
      live = false;
    };
  }, [rpc, projectId]);
  useEffect(() => {
    let live = true;
    setInspection(null);
    setReviewed([]);
    if (sourceId)
      void rpc
        .call("project.inspect", { projectId, environmentId: sourceId })
        .then(async (value) => {
          const nextProject = await rpc.call("project.show", { projectId });
          if (live) {
            setInspection(value);
            setProject(nextProject);
          }
        })
        .catch((error) => {
          if (live) setMessage(errorText(error));
        });
    return () => {
      live = false;
    };
  }, [rpc, sourceId, projectId]);
  async function build() {
    if (!recipe || !sourceId) return;
    setBusy(true);
    setMessage("Preparing reviewed source context…");
    try {
      const context = await rpc.call("context.prepare", {
        projectId,
        environmentId: sourceId,
        recipeId: recipe.recipeId,
        revision: recipe.revision,
        reviewedDirty: reviewed,
      });
      setMessage(
        `Uploading ${context.files} files (${Math.ceil(context.bytes / 1024)} KiB)…`,
      );
      await rpc.call("context.upload", {
        contextId: context.contextId,
        uploadToken: context.uploadToken,
      });
      const result = await rpc.call("build.start", {
        projectId,
        recipeId: recipe.recipeId,
        revision: recipe.revision,
        contextId: context.contextId,
        key: crypto.randomUUID(),
      });
      setBuildId(result.buildId);
      setMessage(
        result.reused ? "Reused the unchanged image build" : "Build requested",
      );
      await refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  if (!loaded || !project)
    return <p role="status">{message || "Loading project catalogue…"}</p>;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p role="status" className="rounded-md border border-border p-3 text-xs">
        {stalenessLabel(
          inspection === null
            ? {
                ...project.staleness,
                lockfilesChanged: null,
                reason: "Source not checked in this view",
              }
            : project.staleness,
        )}
        {project.staleness.lastCheckedAt
          ? ` · checked ${new Date(project.staleness.lastCheckedAt).toLocaleString()}`
          : ""}
      </p>
      <RecipeEditor
        dirtyChanged={setDraftDirty}
        projectId={projectId}
        recipe={recipe}
        save={(input) => rpc.call("recipe.put", input)}
        reload={() => rpc.call("recipe.get", { projectId })}
        saved={(value) => {
          setRecipe(value);
          void refresh().catch((error) => setMessage(errorText(error)));
        }}
      />
      <section className="flex flex-col gap-3" aria-label="Build context">
        <h3 className="font-medium">Source and build</h3>
        <label className="flex flex-col gap-1.5">
          Source checkout
          <select
            aria-label="Source checkout"
            className="max-w-full rounded-md border border-border bg-background p-2"
            value={sourceId}
            disabled={busy}
            onChange={(event) => setSourceId(event.target.value)}
          >
            <option value="">Select a checkout</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.path} · {source.hostId}
              </option>
            ))}
          </select>
        </label>
        {!sources.length && (
          <p className="text-xs">
            Open a local thread in this project to provide a source checkout.
            You can also upload context with bb modal context upload.
          </p>
        )}
        {inspection && (
          <div className="flex flex-col gap-2 text-xs">
            <p className="break-all">Commit {inspection.source.commit}</p>
            <p>
              {inspection.evidence.length} inspected files · setup hooks:{" "}
              {inspection.setupHooks.join(", ") || "none"}
            </p>
            <details>
              <summary className="cursor-pointer">
                Inspect source evidence
              </summary>
              <ul className="max-h-48 overflow-auto font-mono">
                {inspection.evidence.map((file) => (
                  <li key={file.path}>
                    {file.path} · {file.kind} · {file.sha256.slice(0, 12)}
                  </li>
                ))}
              </ul>
            </details>
            {inspection.missing.map((item) => (
              <p key={item}>{item}</p>
            ))}
            {inspection.source.dirty.length > 0 && (
              <fieldset className="flex flex-col gap-1">
                <legend>
                  Review each dirty file before including its overlay
                </legend>
                {inspection.source.dirty.map((path) => (
                  <label
                    key={path}
                    className="flex items-start gap-2 break-all"
                  >
                    <input
                      type="checkbox"
                      checked={reviewed.includes(path)}
                      onChange={(event) =>
                        setReviewed((current) =>
                          event.target.checked
                            ? [...current, path]
                            : current.filter((item) => item !== path),
                        )
                      }
                    />
                    {path}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )}
        <Button
          className="self-start"
          disabled={busy || draftDirty || !recipe || !inspection}
          onClick={() => void build()}
        >
          {busy
            ? "Preparing build…"
            : `Build saved recipe${recipe ? ` · r${recipe.revision}` : ""}`}
        </Button>
        <p className="text-xs text-muted-foreground">
          Builds run only when requested. bb runs the repo’s idempotent
          .bb-env-setup.sh after creating or restoring an owned checkout; the
          hook may start services.
        </p>
        {message && (
          <p role="status" className="break-words text-xs">
            {message}
          </p>
        )}
        {buildId && (
          <BuildLog
            key={buildId}
            buildId={buildId}
            rpc={rpc}
            completed={refresh}
          />
        )}
      </section>
      <ResourcePolicy
        key={`${projectId}:${project.revision}`}
        project={project}
        save={async (value) => {
          await rpc.call("project.configure", {
            ...value,
            expectedRevision: project.revision,
          });
          await refresh();
        }}
      />
      <section
        className="flex min-w-0 flex-col gap-3"
        aria-label="Project images"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="font-medium">Images</h3>
          <label className="flex flex-col gap-1 text-xs">
            Agent provider
            <Input
              aria-label="Verification agent provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Verify runs a real agent smoke turn and a restore check. Use selects a
          verified image for future launches; existing sandboxes keep their
          image. Select an older verified image to roll back future launches.
        </p>
        {!images.length && <p className="text-xs">No builds yet.</p>}
        {images.map((image) => (
          <ImageCard
            key={image.buildId}
            build={image}
            rpc={rpc}
            provider={provider}
            selected={project.usableBuildId === image.buildId}
            logs={() => setBuildId(image.buildId)}
            promote={async () => {
              await rpc.call("project.useImage", {
                projectId,
                buildId: image.buildId,
                agentProviderId: provider,
                expectedRevision: project.revision,
              });
              await refresh();
            }}
          />
        ))}
        {cursor && (
          <Button
            variant="outline"
            onClick={() =>
              void rpc
                .call("image.list", { projectId, cursor, limit: 50 })
                .then((value) => {
                  setImages((current) => [...current, ...value.images]);
                  setCursor(value.nextCursor);
                })
                .catch((error) => setMessage(errorText(error)))
            }
          >
            More images
          </Button>
        )}
      </section>
    </div>
  );
}

function BuildLog({
  buildId,
  rpc,
  completed,
}: {
  buildId: string;
  rpc: Rpc;
  completed: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState("");
  const [terminal, setTerminal] = useState(false);
  useEffect(() => {
    let live = true;
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const [events, build] = await Promise.all([
          rpc.call("build.events", { buildId, cursor, limit: 200 }),
          rpc.call("build.get", { buildId }),
        ]);
        if (!live) return;
        cursor = events.nextCursor;
        setState(build.state);
        setTerminal(events.terminal);
        setText((current) =>
          (
            current +
            events.events.map((event) => event.text).join("\n") +
            "\n"
          ).slice(-256 * 1024),
        );
        if (events.terminal && events.events.length < 200) {
          await completed();
          return;
        }
      } catch (error) {
        if (live) setState(errorText(error));
      }
      if (live) timer = setTimeout(() => void poll(), 1000);
    }
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [rpc, buildId, completed]);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span role="status" className="text-xs">
          Build {state}
        </span>
        {!terminal && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void rpc
                .call("build.cancel", { buildId })
                .catch((error) => setState(errorText(error)))
            }
          >
            Cancel build
          </Button>
        )}
      </div>
      <pre
        aria-label="Build logs"
        className="max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono text-xs"
      >
        {text || "Waiting for logs…"}
      </pre>
      <p className="text-2xs text-muted-foreground">
        Showing the latest 256 KiB. Full bounded logs are available through bb
        modal image logs.
      </p>
    </div>
  );
}

function ResourcePolicy({
  project,
  save,
}: {
  project: Project;
  save: (value: Omit<Project, "revision" | "usableBuildId">) => Promise<void>;
}) {
  const [resources, setResources] = useState(project.resources);
  const [policy, setPolicy] = useState(project.policy);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="flex flex-col gap-3" aria-label="Resources and policy">
      <h3 className="font-medium">Resources and policy</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs">
          Physical CPU cores
          <Input
            type="number"
            min={0.125}
            step={0.125}
            value={resources.cpuCores}
            onChange={(event) =>
              setResources((value) => ({
                ...value,
                cpuCores: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Memory (MiB)
          <Input
            type="number"
            min={128}
            step={128}
            value={resources.memoryMiB}
            onChange={(event) =>
              setResources((value) => ({
                ...value,
                memoryMiB: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Idle pause (minutes; 0 disables)
          <Input
            type="number"
            min={0}
            max={1440}
            value={policy.idleMinutes}
            onChange={(event) =>
              setPolicy((value) => ({
                ...value,
                idleMinutes: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Lifetime (minutes)
          <Input
            type="number"
            min={1}
            max={1440}
            value={policy.lifetimeMinutes}
            onChange={(event) =>
              setPolicy((value) => ({
                ...value,
                lifetimeMinutes: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Retention after last thread (days)
          <Input
            type="number"
            min={1}
            max={365}
            value={policy.retentionDays}
            onChange={(event) =>
              setPolicy((value) => ({
                ...value,
                retentionDays: Number(event.target.value),
              }))
            }
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Defaults: 15 minutes idle, 24 hours lifetime, 30 days retention.
        Retention ends in warned automatic deletion unless you keep the machine.
        Maintenance interrupts active turns and closes terminals before expiry.
        A server outage spanning expiry can lose changes since the last
        snapshot.
      </p>
      <p className="text-xs">
        Estimated running compute: $
        {runningHourlyEstimate(resources.cpuCores, resources.memoryMiB).toFixed(
          4,
        )}
        /hour.{" "}
        <a
          className="underline"
          href="https://modal.com/pricing"
          target="_blank"
          rel="noreferrer"
        >
          Modal rates checked September 8, 2026
        </a>
        . Build/restore time, network and agent charges are additional; snapshot
        storage price is unknown. Actual metering may differ. This is not a cost
        cap.
      </p>
      <Button
        className="self-start"
        disabled={busy}
        variant="outline"
        onClick={() => {
          setBusy(true);
          void save({ projectId: project.projectId, resources, policy })
            .then(() => setMessage("Policy saved"))
            .catch((error) =>
              setMessage(
                `${errorText(error)}. Reload the project to review its latest policy before retrying.`,
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        Save resources and policy
      </Button>
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
    </section>
  );
}

function ImageCard({
  build,
  rpc,
  provider,
  selected,
  logs,
  promote,
}: {
  build: Build;
  rpc: Rpc;
  provider: string;
  selected: boolean;
  logs: () => void;
  promote: () => Promise<void>;
}) {
  const [verification, setVerification] = useState<Verification | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void rpc
      .call("verification.list", { buildId: build.buildId })
      .then((records) => {
        if (live)
          setVerification(
            records.find((record) => record.agentProviderId === provider) ??
              null,
          );
      })
      .catch((error) => {
        if (live) setMessage(errorText(error));
      });
    return () => {
      live = false;
    };
  }, [rpc, build.buildId, provider]);
  const id = verification?.verificationId;
  const terminal =
    verification?.state === "passed" || verification?.state === "failed";
  useEffect(() => {
    if (!id || terminal) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await rpc.call("verification.get", {
          verificationId: id!,
        });
        if (!live) return;
        setVerification(next);
        if (next.state === "passed" || next.state === "failed") return;
      } catch (error) {
        if (live) setMessage(errorText(error));
      }
      if (live) timer = setTimeout(() => void poll(), 1500);
    }
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [rpc, id, terminal]);
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-3 text-xs">
      <div className="flex flex-wrap justify-between gap-2">
        <strong>
          Recipe r{build.revision} · {build.state}
          {selected ? " · selected" : ""}
        </strong>
        <span>{new Date(build.createdAt).toLocaleString()}</span>
      </div>
      <p className="break-all font-mono">{build.buildId}</p>
      {build.failure && <p role="alert">{build.failure}</p>}
      {verification && (
        <p role="status">
          Verification ({provider}): {verification.state}
          {verification.failure ? ` · ${verification.failure}` : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={logs}>
          Logs
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={
            busy || build.state !== "ready" || !provider || (!!id && !terminal)
          }
          onClick={() => {
            setBusy(true);
            void rpc
              .call("verification.start", {
                buildId: build.buildId,
                agentProviderId: provider,
                key: crypto.randomUUID(),
              })
              .then(setVerification)
              .catch((error) => setMessage(errorText(error)))
              .finally(() => setBusy(false));
          }}
        >
          Verify
        </Button>
        <Button
          size="sm"
          disabled={busy || selected || verification?.state !== "passed"}
          onClick={() => {
            setBusy(true);
            void promote()
              .catch((error) => setMessage(errorText(error)))
              .finally(() => setBusy(false));
          }}
        >
          Use image
        </Button>
      </div>
      {message && <p role="alert">{message}</p>}
    </article>
  );
}
