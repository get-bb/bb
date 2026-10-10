import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  experimental_useSidebarThreads,
  useBbNavigate,
  useRpc,
  type PluginAppBuilder,
  type PluginNavPanelProps,
  type PluginThreadHeaderActionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server.js";
import type { Answer } from "./model.js";
import type { LiveSnapshot } from "./use-live.js";
import { PLUGIN_ID } from "./widget.js";

type AnswerViewType = ComponentType<{
  answer: Answer;
  initial: LiveSnapshot;
  surface?: "card" | "panel";
  footer?: ReactNode;
}>;

const PANEL_PATH = "apps";
const PANEL_ACTION = "app";
const INTENT_KEY = `${PLUGIN_ID}:open-intent`;
const INTENT_EVENT = "playgrounds-open-intent";
const INTENT_TTL_MS = 2 * 60 * 1000;
const LICENSES = [
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MPL-2.0",
  "Unlicense",
  "CC0-1.0",
  "CC-BY-4.0",
];

type OpenIntent = {
  threadId: string;
  runId: string;
  title: string;
  at: number;
};

function message(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function writeIntent(intent: Omit<OpenIntent, "at">) {
  try {
    sessionStorage.setItem(
      INTENT_KEY,
      JSON.stringify({ ...intent, at: Date.now() }),
    );
  } catch {
    return;
  }
  window.dispatchEvent(new Event(INTENT_EVENT));
}

function takeIntent(threadId: string): OpenIntent | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(INTENT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let intent: Partial<OpenIntent>;
  try {
    intent = JSON.parse(raw) as Partial<OpenIntent>;
  } catch {
    sessionStorage.removeItem(INTENT_KEY);
    return null;
  }
  if (
    typeof intent.at !== "number" ||
    Date.now() - intent.at > INTENT_TTL_MS ||
    typeof intent.runId !== "string" ||
    typeof intent.title !== "string"
  ) {
    sessionStorage.removeItem(INTENT_KEY);
    return null;
  }
  if (intent.threadId !== threadId) return null;
  sessionStorage.removeItem(INTENT_KEY);
  return intent as OpenIntent;
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(work: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (err) {
      setError(message(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p className="pga-error" role="alert">
      {error}
    </p>
  ) : null;
}

export function SaveAsApp({ answer }: { answer: Answer }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const title =
    answer.kind === "html" ? answer.widget.title : answer.document.title;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(title);
  const [description, setDescription] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const { busy, error, run } = useAsync();
  const nameId = useId();
  const descriptionId = useId();
  if (saved)
    return (
      <div className="pga-save" role="status">
        Saved to My apps. Live inputs and recordings stayed here.{" "}
        <button
          type="button"
          className="pga-link"
          onClick={() =>
            navigate.toPluginPanel(PANEL_PATH, { subPath: `app/${saved}` })
          }
        >
          View in Apps
        </button>
      </div>
    );
  if (!open)
    return (
      <div className="pga-save">
        <button
          type="button"
          className="pga-link"
          onClick={() => setOpen(true)}
        >
          Save as app
        </button>
      </div>
    );
  return (
    <form
      className="pga-save pga-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        void run(() =>
          rpc.call("appsSave", {
            answerId: answer.id,
            threadId: answer.threadId,
            name: name.trim(),
            description: description.trim(),
          }),
        ).then((result) => {
          if (result) setSaved(result.appId);
        });
      }}
    >
      <label htmlFor={nameId}>App name</label>
      <input
        id={nameId}
        value={name}
        maxLength={160}
        onChange={(e) => setName(e.target.value)}
      />
      <label htmlFor={descriptionId}>Description</label>
      <input
        id={descriptionId}
        value={description}
        maxLength={400}
        onChange={(e) => setDescription(e.target.value)}
      />
      <p className="pga-meta">
        Saves the content only. Inputs, recordings, and messages are not copied.
      </p>
      <div className="pga-row">
        <button
          type="submit"
          className="pga-btn pga-primary"
          disabled={busy || !name.trim()}
        >
          Save
        </button>
        <button
          type="button"
          className="pga-btn"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
      <ErrorText error={error} />
    </form>
  );
}

function ThreadPicker({
  value,
  onChange,
  label = "Thread",
}: {
  value: string;
  onChange: (threadId: string) => void;
  label?: string;
}) {
  const id = useId();
  const { threads, projects, status } = experimental_useSidebarThreads();
  const options = useMemo(() => {
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    return [...threads]
      .sort(
        (a, b) =>
          Number(b.isPinned) - Number(a.isPinned) ||
          a.displayTitle.localeCompare(b.displayTitle),
      )
      .map((t) => ({
        id: t.id,
        label: `${t.displayTitle} · ${projectNames.get(t.projectId) ?? "Project"}`,
      }));
  }, [threads, projects]);
  return (
    <span className="pga-picker">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">
          {status === "loading" ? "Loading threads…" : "Choose a thread"}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

function Tabs({ current }: { current: "mine" | "community" | "trash" }) {
  const navigate = useBbNavigate();
  const tab = (id: typeof current, label: string, subPath: string) => (
    <button
      type="button"
      aria-pressed={current === id}
      onClick={() => navigate.toPluginPanel(PANEL_PATH, { subPath })}
    >
      {label}
    </button>
  );
  return (
    <div className="pga-tabs" role="group" aria-label="Apps">
      {tab("mine", "My apps", "")}
      {tab("community", "Community", "community")}
      {tab("trash", "Trash", "trash")}
    </div>
  );
}

type AppSummary = {
  id: string;
  name: string;
  description: string;
  revision: number;
  selectedVersion: { id: string; label: string };
  contentKind: "html" | "document";
  agentActions: "documented" | "manual" | "undocumented";
  author: { name: string } | null;
  license: string | null;
  origin: { kind: string; ref: string | null };
  trashedAt: number | null;
};

function AppList({ trashed }: { trashed: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [query, setQuery] = useState("");
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [version, setVersion] = useState(0);
  const { busy, error, run } = useAsync();
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void rpc
      .call("appsList", {
        ...(query.trim() ? { query: query.trim() } : {}),
        trashed,
      })
      .then((list) => {
        if (active) setApps(list as AppSummary[]);
      })
      .catch(() => {
        if (active) setApps([]);
      });
    return () => {
      active = false;
    };
  }, [rpc, query, trashed, version]);
  const refresh = () => setVersion((n) => n + 1);
  return (
    <section className="pga-section">
      <div className="pga-row">
        <input
          type="search"
          className="pga-search"
          aria-label="Search apps"
          placeholder="Search apps"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {!trashed && (
          <>
            <button
              type="button"
              className="pga-btn"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              Import
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void run(async () => {
                  const result = await rpc.call("appsImport", {
                    text: await file.text(),
                  });
                  navigate.toPluginPanel(PANEL_PATH, {
                    subPath: `app/${result.appId}`,
                  });
                });
              }}
            />
          </>
        )}
      </div>
      <ErrorText error={error} />
      {trashed && (
        <p className="pga-meta">
          Apps in Trash are hidden and cannot be opened in new threads. Existing
          runs keep working.
        </p>
      )}
      {apps === null ? (
        <p className="pga-meta" role="status">
          Loading…
        </p>
      ) : apps.length === 0 ? (
        <p className="pga-empty">
          {trashed
            ? "Trash is empty."
            : query
              ? "No apps match."
              : "No saved apps yet. Use Save as app under a playground to keep it here."}
        </p>
      ) : (
        <ul className="pga-cards">
          {apps.map((app) => (
            <li key={app.id} className="pga-card">
              <div className="pga-card-main">
                <h3>{app.name}</h3>
                {app.description && <p>{app.description}</p>}
                <p className="pga-meta">
                  v{app.selectedVersion.label} ·{" "}
                  {app.contentKind === "html" ? "HTML" : "Native"} ·{" "}
                  {app.agentActions === "documented"
                    ? "Agent actions documented"
                    : app.agentActions === "manual"
                      ? "Manual only"
                      : "Agent actions not documented"}
                  {app.origin.kind === "catalog"
                    ? " · From Community"
                    : app.origin.kind === "remix"
                      ? " · Remix"
                      : ""}
                </p>
              </div>
              <div className="pga-row">
                {trashed ? (
                  <>
                    <button
                      type="button"
                      className="pga-btn"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          rpc.call("appsRestore", { appId: app.id }),
                        ).then(refresh)
                      }
                    >
                      Restore
                    </button>
                    {confirmPurge === app.id ? (
                      <button
                        type="button"
                        className="pga-btn pga-danger"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            rpc.call("appsPurge", {
                              appId: app.id,
                              confirm: true,
                            }),
                          ).then(() => {
                            setConfirmPurge(null);
                            refresh();
                          })
                        }
                      >
                        Delete permanently
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="pga-btn"
                        onClick={() => setConfirmPurge(app.id)}
                      >
                        Delete…
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    className="pga-btn pga-primary"
                    onClick={() =>
                      navigate.toPluginPanel(PANEL_PATH, {
                        subPath: `app/${app.id}`,
                      })
                    }
                  >
                    Open
                  </button>
                )}
              </div>
              {confirmPurge === app.id && (
                <p className="pga-meta">
                  This deletes the app and its versions. Threads that already
                  use it keep their own copies.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Detail = AppSummary & {
  version: {
    id: string;
    label: string;
    title: string;
    summary: string;
    digest: string;
    bytes: number;
    actions:
      | {
          mode: "documented";
          purpose: string;
          actions: {
            name: string;
            description: string;
            args: { type: string; description?: string }[];
          }[];
        }
      | { mode: "manual" }
      | { mode: "undocumented" };
    author: { name: string; url?: string } | null;
    license: string | null;
    origin: {
      kind: string;
      appId: string;
      version: string;
      title: string;
      author?: { name: string };
    } | null;
  };
  versions: { id: string; label: string; digest: string; createdAt: number }[];
};

function ActionsDoc({ actions }: { actions: Detail["version"]["actions"] }) {
  if (actions.mode === "manual")
    return (
      <p className="pga-meta">Manual only: agents cannot operate this app.</p>
    );
  if (actions.mode === "undocumented")
    return (
      <p className="pga-meta">
        Agent actions not documented. Agents can still see live actions with{" "}
        <code>bb playgrounds actions</code>.
      </p>
    );
  return (
    <div>
      <p>{actions.purpose}</p>
      <ul className="pga-actions">
        {actions.actions.map((a) => (
          <li key={a.name}>
            <code>
              {a.name}({a.args.map((arg) => arg.type).join(", ")})
            </code>{" "}
            {a.description}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OpenInThread({
  appId,
  selectedLabel,
  disabled,
}: {
  appId: string;
  selectedLabel: string;
  disabled: boolean;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [threadId, setThreadId] = useState("");
  const { busy, error, run } = useAsync();
  const open = (fresh: boolean) =>
    void run(() => rpc.call("appsOpen", { appId, threadId, fresh })).then(
      (result) => {
        if (!result) return;
        writeIntent({
          threadId: result.threadId,
          runId: result.runId,
          title: `App v${result.versionLabel}`,
        });
        navigate.toThread(result.threadId);
      },
    );
  return (
    <div className="pga-panel">
      <h4>Open in a thread</h4>
      <p className="pga-meta">
        Open resumes that thread's latest run of this app, whatever version it
        uses. Start fresh creates a separate run on v{selectedLabel}.
      </p>
      <div className="pga-row">
        <ThreadPicker value={threadId} onChange={setThreadId} />
        <button
          type="button"
          className="pga-btn pga-primary"
          disabled={disabled || busy || !threadId}
          onClick={() => open(false)}
        >
          Open
        </button>
        <button
          type="button"
          className="pga-btn"
          disabled={disabled || busy || !threadId}
          onClick={() => open(true)}
        >
          Start fresh
        </button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

type DraftView = {
  appId: string;
  revision: number;
  baseVersionLabel: string | null;
  package: {
    title: string;
    summary: string;
    content:
      | {
          kind: "html";
          playground: { title: string; html: string; width?: number };
        }
      | { kind: "document"; document: unknown };
    actions: unknown;
    author?: { name: string; url?: string };
    license?: string;
  };
  diff: string;
  catalogId: string | null;
  publishedVersion: string | null;
};

function DraftEditor({
  appId,
  onChanged,
}: {
  appId: string;
  onChanged: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [draft, setDraft] = useState<DraftView | null | undefined>(undefined);
  const [form, setForm] = useState<{
    title: string;
    summary: string;
    source: string;
    actions: string;
  } | null>(null);
  const [previewThread, setPreviewThread] = useState("");
  const { busy, error, setError, run } = useAsync();
  const load = useCallback((next: DraftView | null) => {
    setDraft(next);
    setForm(
      next
        ? {
            title: next.package.title,
            summary: next.package.summary,
            source:
              next.package.content.kind === "html"
                ? next.package.content.playground.html
                : JSON.stringify(next.package.content.document, null, 2),
            actions: JSON.stringify(next.package.actions, null, 2),
          }
        : null,
    );
  }, []);
  useEffect(() => {
    void rpc.call("draftGet", { appId }).then(
      (d) => load(d as DraftView | null),
      () => load(null),
    );
  }, [rpc, appId, load]);
  if (draft === undefined) return null;
  if (!draft || !form)
    return (
      <div className="pga-panel">
        <h4>Develop</h4>
        <p className="pga-meta">
          Edit a private working draft. Saving or previewing it never changes
          existing versions, running sessions, or a Community listing.
        </p>
        <button
          type="button"
          className="pga-btn"
          disabled={busy}
          onClick={() =>
            void run(() => rpc.call("draftOpen", { appId })).then(
              (d) => d && load(d as DraftView),
            )
          }
        >
          Develop
        </button>
        <ErrorText error={error} />
      </div>
    );
  const html = draft.package.content.kind === "html";
  const dirty =
    form.title !== draft.package.title ||
    form.summary !== draft.package.summary ||
    form.source !==
      (draft.package.content.kind === "html"
        ? draft.package.content.playground.html
        : JSON.stringify(draft.package.content.document, null, 2)) ||
    (html && form.actions !== JSON.stringify(draft.package.actions, null, 2));
  const save = () =>
    run(async () => {
      const next = await rpc.call("draftWrite", {
        appId,
        expectedRevision: draft.revision,
        edit: {
          title: form.title,
          summary: form.summary,
          ...(html
            ? { html: form.source, actionsJson: form.actions }
            : { documentJson: form.source }),
        },
      });
      load(next as DraftView);
      onChanged();
      return next;
    });
  return (
    <div className="pga-panel">
      <h4>
        Draft · revision {draft.revision}
        {draft.baseVersionLabel ? ` · based on v${draft.baseVersionLabel}` : ""}
      </h4>
      <p className="pga-meta">
        Private until you prepare a release. Ask an agent to edit it with{" "}
        <code>
          bb playgrounds apps draft set {appId} --revision {draft.revision}
        </code>
        .
      </p>
      <label className="pga-field">
        Title
        <input
          value={form.title}
          maxLength={160}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </label>
      <label className="pga-field">
        Summary
        <input
          value={form.summary}
          maxLength={400}
          onChange={(e) => setForm({ ...form, summary: e.target.value })}
        />
      </label>
      <label className="pga-field">
        {html ? "HTML" : "Document JSON"}
        <textarea
          className="pga-code"
          rows={14}
          spellCheck={false}
          value={form.source}
          onChange={(e) => setForm({ ...form, source: e.target.value })}
        />
      </label>
      {html && (
        <label className="pga-field">
          Agent actions (JSON)
          <textarea
            className="pga-code"
            rows={8}
            spellCheck={false}
            value={form.actions}
            onChange={(e) => setForm({ ...form, actions: e.target.value })}
          />
        </label>
      )}
      <div className="pga-row">
        <button
          type="button"
          className="pga-btn pga-primary"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          Save draft
        </button>
        <button
          type="button"
          className="pga-btn"
          disabled={busy}
          onClick={() =>
            void run(() => rpc.call("draftGet", { appId })).then(
              (d) => d !== undefined && load(d as DraftView | null),
            )
          }
        >
          Reload
        </button>
        <button
          type="button"
          className="pga-btn"
          disabled={busy}
          onClick={() =>
            void run(() =>
              rpc.call("draftDiscard", {
                appId,
                expectedRevision: draft.revision,
              }),
            ).then((r) => {
              if (r) load(null);
            })
          }
        >
          Discard draft
        </button>
      </div>
      <div className="pga-row">
        <ThreadPicker
          value={previewThread}
          onChange={setPreviewThread}
          label="Preview in"
        />
        <button
          type="button"
          className="pga-btn"
          disabled={busy || dirty || !previewThread}
          title={dirty ? "Save the draft first" : undefined}
          onClick={() =>
            void run(() =>
              rpc.call("draftPreview", { appId, threadId: previewThread }),
            ).then((result) => {
              if (!result) return;
              writeIntent({
                threadId: result.threadId,
                runId: result.runId,
                title: `Draft preview r${result.draftRevision}`,
              });
              navigate.toThread(result.threadId);
            })
          }
        >
          Preview
        </button>
      </div>
      {draft.diff && (
        <details>
          <summary>Changes from v{draft.baseVersionLabel}</summary>
          <pre className="pga-diff">{draft.diff}</pre>
        </details>
      )}
      <ErrorText error={error} />
      {error?.includes("changed since") && (
        <button
          type="button"
          className="pga-link"
          onClick={() => setError(null)}
        >
          Dismiss
        </button>
      )}
      <ReleasePanel appId={appId} draft={draft} dirty={dirty} />
    </div>
  );
}

type ReleaseView = {
  id: string;
  version: string;
  status: "prepared" | "submitted" | "published" | "failed" | "superseded";
  prUrl: string | null;
  note: string | null;
  catalogId: string;
  changelog: string;
  kind: "initial" | "update";
  ready: boolean;
  blockers: string[];
  files: { path: string; sha256: string; bytes: number }[];
  catalogEntry: unknown;
  contributing: string | null;
  diff: string;
  diffBase: string | null;
  agentRequest: string | null;
};

const STATUS_LABEL: Record<ReleaseView["status"], string> = {
  prepared: "Prepared",
  submitted: "Submitted",
  published: "Published",
  failed: "Needs attention",
  superseded: "Superseded",
};

function ReleasePanel({
  appId,
  draft,
  dirty,
}: {
  appId: string;
  draft: DraftView;
  dirty: boolean;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [releases, setReleases] = useState<ReleaseView[]>([]);
  const [current, setCurrent] = useState<ReleaseView | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [form, setForm] = useState({
    catalogId: "",
    version: "",
    changelog: "",
    author: draft.package.author?.name ?? "",
    authorUrl: draft.package.author?.url ?? "",
    license: draft.package.license ?? "",
    reviewed: false,
  });
  const { busy, error, run } = useAsync();
  const reload = useCallback(() => {
    void rpc.call("releaseList", { appId }).then(
      async (list) => {
        const views = await Promise.all(
          (list as { id: string }[])
            .slice(0, 5)
            .map(
              (r) =>
                rpc.call("releaseShow", {
                  releaseId: r.id,
                }) as Promise<ReleaseView>,
            ),
        );
        setReleases(views);
        setCurrent(
          (c) =>
            views.find((v) => v.id === c?.id) ??
            views.find(
              (v) => v.status === "prepared" || v.status === "submitted",
            ) ??
            null,
        );
      },
      () => {},
    );
  }, [rpc, appId]);
  useEffect(reload, [reload]);
  const firstSubmission = !draft.catalogId;
  return (
    <div className="pga-release">
      <h4>Community release</h4>
      <p className="pga-meta">
        {draft.catalogId
          ? `Listing ${draft.catalogId}${draft.publishedVersion ? ` · published v${draft.publishedVersion}` : " · not yet published"}`
          : "Not submitted yet. A release creates an immutable version plus the files for a catalog pull request."}
      </p>
      {releases.length > 0 && (
        <ul className="pga-releases">
          {releases.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="pga-link"
                onClick={() => setCurrent(r)}
              >
                v{r.version}
              </button>{" "}
              <span className="pga-chip" data-status={r.status}>
                {STATUS_LABEL[r.status]}
              </span>
              {r.prUrl && (
                <>
                  {" "}
                  <a href={r.prUrl} target="_blank" rel="noreferrer">
                    Pull request
                  </a>
                </>
              )}
              {r.note && <span className="pga-meta"> {r.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {current && (
        <div className="pga-panel">
          <h4>
            v{current.version} · {STATUS_LABEL[current.status]}
            {current.status === "submitted"
              ? " (proposal, not yet published)"
              : ""}
          </h4>
          <p>{current.changelog}</p>
          {current.blockers.map((b) => (
            <p key={b} className="pga-meta">
              {b}
            </p>
          ))}
          <div className="pga-row">
            {current.agentRequest && (
              <button
                type="button"
                className="pga-btn pga-primary"
                disabled={!current.ready}
                onClick={() =>
                  navigate.toCompose({
                    initialPrompt: current.agentRequest!,
                    focusPrompt: true,
                  })
                }
              >
                {current.prUrl
                  ? "Update submission with agent"
                  : "Submit with agent"}
              </button>
            )}
            <button
              type="button"
              className="pga-btn"
              onClick={() =>
                void run(async () => {
                  const file = await rpc.call("releasePackage", {
                    releaseId: current.id,
                  });
                  download(
                    file.path.split("/").pop() ?? "package.json",
                    file.text,
                  );
                })
              }
            >
              Download package
            </button>
            <button
              type="button"
              className="pga-btn"
              onClick={() =>
                download(
                  `${current.catalogId.replace("/", "-")}-entry.json`,
                  `${JSON.stringify(current.catalogEntry, null, 2)}\n`,
                )
              }
            >
              Download catalog entry
            </button>
            {(current.status === "prepared" ||
              current.status === "submitted") && (
              <>
                <button
                  type="button"
                  className="pga-btn"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      rpc.call("releaseRefresh", { releaseId: current.id }),
                    ).then(reload)
                  }
                >
                  Re-check catalog
                </button>
                <button
                  type="button"
                  className="pga-btn"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      rpc.call("releaseFailed", {
                        releaseId: current.id,
                        note: "Declined or closed; draft kept.",
                      }),
                    ).then(reload)
                  }
                >
                  Mark declined
                </button>
              </>
            )}
          </div>
          {current.contributing && (
            <p className="pga-meta">
              Without an agent, follow the{" "}
              <a href={current.contributing} target="_blank" rel="noreferrer">
                contribution instructions
              </a>{" "}
              with the downloaded files.
            </p>
          )}
          <details>
            <summary>
              {current.diffBase
                ? `Changes since published v${current.diffBase}`
                : "Everything that will be public"}
            </summary>
            <pre className="pga-diff">{current.diff || "No changes."}</pre>
          </details>
        </div>
      )}
      {preparing ? (
        <form
          className="pga-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const { releaseId } = await rpc.call("releasePrepare", {
                appId,
                expectedDraftRevision: draft.revision,
                changelog: form.changelog,
                reviewed: form.reviewed,
                ...(form.version.trim()
                  ? { version: form.version.trim() }
                  : {}),
                ...(firstSubmission
                  ? { catalogId: form.catalogId.trim() }
                  : {}),
                ...(form.author.trim()
                  ? {
                      author: {
                        name: form.author.trim(),
                        ...(form.authorUrl.trim()
                          ? { url: form.authorUrl.trim() }
                          : {}),
                      },
                    }
                  : {}),
                ...(form.license ? { license: form.license } : {}),
              });
              setPreparing(false);
              const view = (await rpc.call("releaseShow", {
                releaseId,
              })) as ReleaseView;
              setCurrent(view);
              reload();
            });
          }}
        >
          {firstSubmission && (
            <label className="pga-field">
              Community ID (owner/name)
              <input
                value={form.catalogId}
                onChange={(e) =>
                  setForm({ ...form, catalogId: e.target.value })
                }
              />
            </label>
          )}
          <label className="pga-field">
            Version (blank proposes the next one)
            <input
              value={form.version}
              maxLength={40}
              onChange={(e) => setForm({ ...form, version: e.target.value })}
            />
          </label>
          <label className="pga-field">
            What changed
            <textarea
              rows={3}
              maxLength={1000}
              value={form.changelog}
              onChange={(e) => setForm({ ...form, changelog: e.target.value })}
            />
          </label>
          <label className="pga-field">
            Public author name
            <input
              value={form.author}
              maxLength={80}
              onChange={(e) => setForm({ ...form, author: e.target.value })}
            />
          </label>
          <label className="pga-field">
            Author link (optional, https)
            <input
              value={form.authorUrl}
              onChange={(e) => setForm({ ...form, authorUrl: e.target.value })}
            />
          </label>
          <label className="pga-field">
            License
            <select
              value={form.license}
              onChange={(e) => setForm({ ...form, license: e.target.value })}
            >
              <option value="">Choose a license</option>
              {LICENSES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="pga-check">
            <input
              type="checkbox"
              checked={form.reviewed}
              onChange={(e) => setForm({ ...form, reviewed: e.target.checked })}
            />
            I reviewed the source and metadata for personal content and confirm
            I can redistribute it. Nothing is anonymized automatically.
          </label>
          <div className="pga-row">
            <button
              type="submit"
              className="pga-btn pga-primary"
              disabled={busy || !form.reviewed || !form.changelog.trim()}
            >
              Prepare release
            </button>
            <button
              type="button"
              className="pga-btn"
              onClick={() => setPreparing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="pga-btn"
          disabled={dirty}
          title={dirty ? "Save the draft first" : undefined}
          onClick={() => setPreparing(true)}
        >
          {firstSubmission ? "Prepare submission" : "Prepare update"}
        </button>
      )}
      <ErrorText error={error} />
    </div>
  );
}

function AppDetail({ appId }: { appId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    name: string;
    description: string;
  } | null>(null);
  const [version, setVersion] = useState(0);
  const { busy, error, run } = useAsync();
  useEffect(() => {
    let active = true;
    void rpc.call("appsDescribe", { appId }).then(
      (d) => active && setDetail(d as Detail),
      (err: unknown) => active && setLoadError(message(err)),
    );
    return () => {
      active = false;
    };
  }, [rpc, appId, version]);
  const refresh = () => setVersion((n) => n + 1);
  if (loadError) return <ErrorText error={loadError} />;
  if (!detail)
    return (
      <p className="pga-meta" role="status">
        Loading…
      </p>
    );
  const origin = detail.version.origin;
  return (
    <section className="pga-section">
      <button
        type="button"
        className="pga-link"
        onClick={() =>
          navigate.toPluginPanel(PANEL_PATH, {
            subPath: detail.trashedAt ? "trash" : "",
          })
        }
      >
        ← Back
      </button>
      {editing ? (
        <form
          className="pga-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              rpc.call("appsUpdate", {
                appId,
                expectedRevision: detail.revision,
                name: editing.name,
                description: editing.description,
              }),
            ).then((r) => {
              if (r) {
                setEditing(null);
                refresh();
              }
            });
          }}
        >
          <label className="pga-field">
            Name
            <input
              value={editing.name}
              maxLength={160}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </label>
          <label className="pga-field">
            Description
            <input
              value={editing.description}
              maxLength={400}
              onChange={(e) =>
                setEditing({ ...editing, description: e.target.value })
              }
            />
          </label>
          <div className="pga-row">
            <button
              type="submit"
              className="pga-btn pga-primary"
              disabled={busy}
            >
              Save
            </button>
            <button
              type="button"
              className="pga-btn"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <header className="pga-head">
          <div>
            <h2>{detail.name}</h2>
            {detail.description && <p>{detail.description}</p>}
            <p className="pga-meta">
              {detail.contentKind === "html" ? "HTML" : "Native"} · v
              {detail.selectedVersion.label}
              {detail.version.author ? ` · ${detail.version.author.name}` : ""}
              {detail.version.license ? ` · ${detail.version.license}` : ""}
              {detail.trashedAt ? " · In Trash" : ""}
            </p>
            {origin && (
              <p className="pga-meta">
                {origin.kind === "remix" ? "Remixed from" : "From"}{" "}
                {origin.title} v{origin.version}
                {origin.author ? ` by ${origin.author.name}` : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            className="pga-btn"
            onClick={() =>
              setEditing({ name: detail.name, description: detail.description })
            }
          >
            Edit
          </button>
        </header>
      )}
      <ErrorText error={error} />
      <OpenInThread
        appId={appId}
        selectedLabel={detail.selectedVersion.label}
        disabled={detail.trashedAt !== null}
      />
      <div className="pga-panel">
        <h4>Agent actions</h4>
        <ActionsDoc actions={detail.version.actions} />
      </div>
      <div className="pga-panel">
        <h4>Versions</h4>
        <ul className="pga-versions">
          {detail.versions.map((v) => (
            <li key={v.id}>
              <label className="pga-check">
                <input
                  type="radio"
                  name={`default-${appId}`}
                  checked={v.id === detail.selectedVersion.id}
                  disabled={busy}
                  onChange={() =>
                    void run(() =>
                      rpc.call("appsUpdate", {
                        appId,
                        expectedRevision: detail.revision,
                        selectedVersionId: v.id,
                      }),
                    ).then(refresh)
                  }
                />
                v{v.label} · {new Date(v.createdAt).toLocaleDateString()} ·{" "}
                <code>{v.digest.slice(0, 12)}</code>
              </label>
            </li>
          ))}
        </ul>
        <p className="pga-meta">
          The checked version is used for new runs. Existing runs keep their
          version.
        </p>
      </div>
      <div className="pga-row">
        <button
          type="button"
          className="pga-btn"
          disabled={busy}
          onClick={() =>
            void run(() => rpc.call("appsRemix", { appId })).then(
              (r) =>
                r &&
                navigate.toPluginPanel(PANEL_PATH, {
                  subPath: `app/${r.appId}`,
                }),
            )
          }
        >
          Remix
        </button>
        <button
          type="button"
          className="pga-btn"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const file = await rpc.call("appsExport", { appId });
              download(file.filename, file.text);
            })
          }
        >
          Export
        </button>
        {detail.trashedAt ? (
          <button
            type="button"
            className="pga-btn"
            disabled={busy}
            onClick={() =>
              void run(() => rpc.call("appsRestore", { appId })).then(refresh)
            }
          >
            Restore
          </button>
        ) : (
          <button
            type="button"
            className="pga-btn"
            disabled={busy}
            onClick={() =>
              void run(() => rpc.call("appsTrash", { appId })).then(refresh)
            }
          >
            Move to Trash
          </button>
        )}
      </div>
      <p className="pga-meta">
        Export keeps the app and its attribution, not your runs. Uninstalling
        Playgrounds may remove My apps; export what you want to keep.
      </p>
      {detail.origin.kind !== "catalog" && !detail.trashedAt && (
        <DraftEditor appId={appId} onChanged={refresh} />
      )}
    </section>
  );
}

type CommunityApp = {
  id: string;
  title: string;
  summary: string;
  author: { name: string; url?: string };
  license: string;
  agentActions: "documented" | "manual";
  hasPreview: boolean;
  delisted: boolean;
  latest: { version: string; notes: string | null } | null;
  versions: {
    version: string;
    notes: string | null;
    delisted: boolean;
    changed: boolean;
  }[];
  installed: {
    appId: string;
    versions: string[];
    selected: string | null;
    selectedDelisted: boolean;
    trashed: boolean;
  } | null;
  updateAvailable: boolean;
  authoredAppId: string | null;
};
type CommunityState = {
  configured: boolean;
  revision: string | null;
  refreshedAt: number | null;
  error: string | null;
  contributing: string | null;
  apps: CommunityApp[];
};

function Community() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<CommunityState | null>(null);
  const [inspected, setInspected] = useState<Record<string, unknown>>({});
  const { busy, error, run } = useAsync();
  const load = useCallback(
    (refreshIfStale: boolean) =>
      rpc
        .call("communityList", {
          ...(query.trim() ? { query: query.trim() } : {}),
          refreshIfStale,
        })
        .then((s) => setState(s as CommunityState)),
    [rpc, query],
  );
  const first = useRef(true);
  useEffect(() => {
    void load(first.current).catch(() => {});
    first.current = false;
  }, [load]);
  if (!state)
    return (
      <p className="pga-meta" role="status">
        Loading…
      </p>
    );
  if (!state.configured)
    return (
      <section className="pga-section">
        <p className="pga-empty">
          No Community catalog is configured, so there is nothing to browse yet.
          My apps works without one. To browse a catalog, set its index URL in
          the Playgrounds plugin's Community catalog URL setting.
        </p>
      </section>
    );
  const add = (app: CommunityApp, version?: string) =>
    void run(() =>
      rpc.call("communityAdd", {
        catalogId: app.id,
        ...(version ? { version } : {}),
      }),
    ).then(() => load(false));
  return (
    <section className="pga-section">
      <div className="pga-row">
        <input
          type="search"
          className="pga-search"
          aria-label="Search Community apps"
          placeholder="Search Community"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="pga-btn"
          disabled={busy}
          onClick={() =>
            void run(() => rpc.call("communityRefresh", {})).then(() =>
              load(false),
            )
          }
        >
          Refresh
        </button>
      </div>
      <p className="pga-meta" role="status">
        {state.refreshedAt
          ? `Catalog ${state.revision} · checked ${new Date(state.refreshedAt).toLocaleString()}`
          : "Catalog not loaded yet."}
        {state.error
          ? ` · Last refresh failed: ${state.error}. Showing the last good catalog.`
          : ""}
      </p>
      <p className="pga-meta">
        Previews are static images; browsing never runs app code. Your settings
        and recordings stay private.
      </p>
      <ErrorText error={error} />
      {state.apps.length === 0 ? (
        <p className="pga-empty">
          {query ? "No Community apps match." : "The catalog has no apps yet."}
        </p>
      ) : (
        <ul className="pga-cards">
          {state.apps.map((app) => {
            const details = inspected[app.id] as
              | {
                  actions: Detail["version"]["actions"];
                  digest: string;
                  version: string;
                  source: string | null;
                }
              | undefined;
            return (
              <li key={app.id} className="pga-card">
                {app.hasPreview && (
                  <img
                    className="pga-preview"
                    alt=""
                    loading="lazy"
                    src={`/api/v1/plugins/${PLUGIN_ID}/http/community/preview?id=${encodeURIComponent(app.id)}`}
                  />
                )}
                <div className="pga-card-main">
                  <h3>{app.title}</h3>
                  <p>{app.summary}</p>
                  <p className="pga-meta">
                    {app.author.name} · {app.license} ·{" "}
                    {app.latest ? `v${app.latest.version}` : "Delisted"} ·{" "}
                    {app.id}
                    {app.installed
                      ? ` · Installed v${app.installed.selected}`
                      : ""}
                    {app.installed?.selectedDelisted ? " (delisted)" : ""}
                  </p>
                  {app.updateAvailable && app.latest?.notes && (
                    <p className="pga-meta">
                      New in v{app.latest.version}: {app.latest.notes}
                    </p>
                  )}
                  {details && (
                    <div className="pga-panel">
                      <ActionsDoc actions={details.actions} />
                      <p className="pga-meta">
                        v{details.version} · sha256{" "}
                        <code>{details.digest.slice(0, 16)}</code>
                        {details.source ? ` · ${details.source}` : ""}
                      </p>
                    </div>
                  )}
                </div>
                <div className="pga-row">
                  {!details && (
                    <button
                      type="button"
                      className="pga-btn"
                      disabled={busy || !app.latest}
                      onClick={() =>
                        void run(() =>
                          rpc.call("communityInspect", { catalogId: app.id }),
                        ).then(
                          (d) =>
                            d && setInspected((m) => ({ ...m, [app.id]: d })),
                        )
                      }
                    >
                      Details
                    </button>
                  )}
                  {app.authoredAppId ? (
                    <button
                      type="button"
                      className="pga-btn"
                      onClick={() =>
                        navigate.toPluginPanel(PANEL_PATH, {
                          subPath: `app/${app.authoredAppId}`,
                        })
                      }
                    >
                      Develop yours
                    </button>
                  ) : app.installed ? (
                    <>
                      {app.updateAvailable && app.latest && (
                        <button
                          type="button"
                          className="pga-btn pga-primary"
                          disabled={busy}
                          onClick={() => add(app, app.latest!.version)}
                        >
                          Update to v{app.latest.version}
                        </button>
                      )}
                      <button
                        type="button"
                        className="pga-btn"
                        onClick={() =>
                          navigate.toPluginPanel(PANEL_PATH, {
                            subPath: `app/${app.installed!.appId}`,
                          })
                        }
                      >
                        Open
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="pga-btn pga-primary"
                      disabled={busy || !app.latest}
                      onClick={() => add(app)}
                    >
                      Add to My apps
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {state.contributing && (
        <p className="pga-meta">
          Share your own: prepare a submission from an app's Develop section, or
          read the{" "}
          <a href={state.contributing} target="_blank" rel="noreferrer">
            contribution instructions
          </a>
          .
        </p>
      )}
    </section>
  );
}

function AppsPage({ subPath }: PluginNavPanelProps) {
  const [section, rest] = [
    subPath.split("/")[0] ?? "",
    subPath.split("/").slice(1).join("/"),
  ];
  const current =
    section === "community"
      ? "community"
      : section === "trash"
        ? "trash"
        : "mine";
  return (
    <div className="pga">
      <Tabs current={section === "app" ? "mine" : current} />
      {section === "app" && rest ? (
        <AppDetail key={rest} appId={rest} />
      ) : current === "community" ? (
        <Community />
      ) : (
        <AppList trashed={current === "trash"} />
      )}
    </div>
  );
}

type RunInfo = {
  runId: string;
  threadId: string;
  appId: string;
  appName: string;
  appAvailable: boolean;
  versionLabel: string;
  selectedVersionLabel: string | null;
  selectedVersionId: string | null;
  versionId: string;
  inherited: boolean;
  preview: boolean;
} | null;

function RunPanel({
  threadId,
  runId,
  AnswerView,
}: {
  threadId: string;
  runId: string;
  AnswerView: AnswerViewType;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [loaded, setLoaded] = useState<{
    answer: Answer;
    initial: LiveSnapshot;
    info: RunInfo;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy, error, run } = useAsync();
  useEffect(() => {
    let active = true;
    void Promise.all([
      rpc.call("get", { id: runId, threadId }),
      rpc.call("getState", { id: runId, threadId }),
      rpc.call("appsRunInfo", { runId, threadId }),
    ]).then(
      ([answer, initial, info]) =>
        active && setLoaded({ answer, initial, info: info as RunInfo }),
      (err: unknown) => active && setLoadError(message(err)),
    );
    return () => {
      active = false;
    };
  }, [rpc, runId, threadId]);
  if (loadError)
    return (
      <div className="pga" role="alert">
        <p>{loadError}</p>
      </div>
    );
  if (!loaded)
    return (
      <div className="pga" role="status">
        Loading app…
      </div>
    );
  const { info } = loaded;
  const stale =
    info &&
    !info.preview &&
    info.appAvailable &&
    info.selectedVersionId &&
    info.selectedVersionId !== info.versionId;
  return (
    <div className="pga pga-run">
      {info && (
        <div className="pga-run-head">
          <span>
            {info.appName} ·{" "}
            {info.preview
              ? `Draft preview (${info.versionLabel})`
              : `v${info.versionLabel}`}
            {info.inherited ? " · Copied from the original thread" : ""}
          </span>
          {stale && (
            <button
              type="button"
              className="pga-btn"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  rpc.call("appsOpen", {
                    appId: info.appId,
                    threadId,
                    fresh: true,
                  }),
                ).then((result) => {
                  if (result)
                    navigate.openThreadPanel({
                      actionId: PANEL_ACTION,
                      params: { runId: result.runId },
                      title: `${info.appName} v${result.versionLabel}`,
                    });
                })
              }
            >
              Start fresh on v{info.selectedVersionLabel}
            </button>
          )}
        </div>
      )}
      <ErrorText error={error} />
      <AnswerView
        answer={loaded.answer}
        initial={loaded.initial}
        surface="panel"
      />
    </div>
  );
}

function Launcher({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const { busy, error, run } = useAsync();
  useEffect(() => {
    void rpc.call("appsList", {}).then(
      (list) => setApps(list as AppSummary[]),
      () => setApps([]),
    );
  }, [rpc]);
  return (
    <div className="pga">
      <h3>Open an app in this thread</h3>
      <ErrorText error={error} />
      {apps === null ? (
        <p className="pga-meta" role="status">
          Loading…
        </p>
      ) : apps.length === 0 ? (
        <p className="pga-empty">
          No saved apps yet. Use Save as app under a playground.
        </p>
      ) : (
        <ul className="pga-cards">
          {apps.map((app) => (
            <li key={app.id} className="pga-card">
              <div className="pga-card-main">
                <h3>{app.name}</h3>
                <p className="pga-meta">v{app.selectedVersion.label}</p>
              </div>
              <button
                type="button"
                className="pga-btn pga-primary"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    rpc.call("appsOpen", {
                      appId: app.id,
                      threadId,
                      fresh: false,
                    }),
                  ).then((result) => {
                    if (result)
                      navigate.openThreadPanel({
                        actionId: PANEL_ACTION,
                        params: { runId: result.runId },
                        title: `${app.name} v${result.versionLabel}`,
                      });
                  })
                }
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function makeThreadPanel(AnswerView: AnswerViewType) {
  return function AppThreadPanel({ threadId, params }: PluginThreadPanelProps) {
    const runId =
      params &&
      typeof params === "object" &&
      !Array.isArray(params) &&
      typeof params.runId === "string"
        ? params.runId
        : null;
    return runId ? (
      <RunPanel
        key={runId}
        threadId={threadId}
        runId={runId}
        AnswerView={AnswerView}
      />
    ) : (
      <Launcher threadId={threadId} />
    );
  };
}

function OpenIntentAction({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [declined, setDeclined] = useState<OpenIntent | null>(null);
  const open = useCallback(
    (intent: OpenIntent) => {
      const accepted = navigate.openThreadPanel({
        actionId: PANEL_ACTION,
        params: { runId: intent.runId },
        title: intent.title,
      });
      setDeclined(accepted ? null : intent);
    },
    [navigate],
  );
  useEffect(() => {
    const consume = () => {
      const intent = takeIntent(threadId);
      if (!intent) return;
      void rpc.call("get", { id: intent.runId, threadId }).then(
        (answer) => {
          if (answer.id === intent.runId) open(intent);
        },
        () => {},
      );
    };
    consume();
    window.addEventListener(INTENT_EVENT, consume);
    return () => window.removeEventListener(INTENT_EVENT, consume);
  }, [rpc, threadId, open]);
  if (!declined) return null;
  return (
    <button
      type="button"
      className="pga-btn"
      onClick={() => open(declined)}
      aria-label="Open app"
    >
      {isCompactViewport ? "App" : "Open app"}
    </button>
  );
}

export function registerLibrary(
  app: PluginAppBuilder,
  AnswerView: AnswerViewType,
) {
  app.slots.navPanel({
    id: "apps",
    title: "Apps",
    icon: "LayoutGrid",
    path: PANEL_PATH,
    component: AppsPage,
  });
  app.slots.threadPanelAction({
    id: PANEL_ACTION,
    title: "Apps",
    icon: "LayoutGrid",
    layout: "padded",
    component: makeThreadPanel(AnswerView),
  });
  app.slots.experimental_threadHeaderAction({
    id: "open-app",
    title: "Playgrounds app",
    component: OpenIntentAction,
  });
}
