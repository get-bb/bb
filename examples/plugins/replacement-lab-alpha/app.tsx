import { useState } from "react";
import {
  definePluginApp,
  type ExperimentalChangesViewProps,
  type ExperimentalSidebarNavigationProps,
  type PluginFileOpenerProps,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";

const LABEL = "Alpha";

function AlphaSidebarNavigation({
  activeItemId,
  experimental_Original: Original,
  experimental_activate,
  items,
}: ExperimentalSidebarNavigationProps) {
  const [embedOriginal, setEmbedOriginal] = useState(false);
  const [shouldCrash, setShouldCrash] = useState(false);
  if (shouldCrash) throw new Error("Alpha sidebar-navigation test crash");
  if (embedOriginal) return <Original />;

  return (
    <section className="shrink-0 space-y-2 px-2 py-2 text-xs">
      <div className="flex items-center gap-2">
        <strong className="mr-auto">Alpha · Navigation</strong>
        <button
          type="button"
          className="rounded border border-border px-2 py-1 hover:bg-muted"
          onClick={() => setEmbedOriginal(true)}
        >
          BB original
        </button>
        <button
          type="button"
          className="rounded border border-border px-2 py-1 hover:bg-muted"
          onClick={() => setShouldCrash(true)}
        >
          Crash
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={item.isDisabled}
            aria-current={item.id === activeItemId ? "page" : undefined}
            aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
            className="truncate rounded border border-border px-2 py-1.5 text-left hover:bg-muted disabled:opacity-50"
            {...item.experimental_splitProps}
            onClick={(event) =>
              experimental_activate(item.id, {
                openInSplit: event.metaKey || event.ctrlKey,
              })
            }
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function AlphaThreadList({
  activeProjectId,
  activeThreadId,
  Original,
  searchQuery,
}: PluginThreadListProps) {
  const [embedOriginal, setEmbedOriginal] = useState(false);
  const [shouldCrash, setShouldCrash] = useState(false);
  if (shouldCrash) throw new Error("Alpha thread-list test crash");

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      <LabHeader
        kind="Thread list"
        embedOriginal={embedOriginal}
        onEmbedOriginalChange={setEmbedOriginal}
        onCrash={() => setShouldCrash(true)}
      />
      {embedOriginal ? (
        <div className="flex min-h-0 flex-1 flex-col border-t border-border">
          <Original />
        </div>
      ) : (
        <div className="space-y-3 overflow-auto p-3 text-xs">
          <p className="rounded-md border border-border bg-muted/30 p-3">
            Alpha owns the scrolling thread-list region.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-muted-foreground">
            <dt>Thread</dt>
            <dd className="truncate font-mono">{activeThreadId ?? "none"}</dd>
            <dt>Project</dt>
            <dd className="truncate font-mono">{activeProjectId ?? "none"}</dd>
            <dt>Search</dt>
            <dd className="truncate font-mono">{searchQuery || "empty"}</dd>
          </dl>
          <p className="text-muted-foreground">
            Use Appearance → Sidebar to switch to Beta, BB, or Automatic.
          </p>
        </div>
      )}
    </section>
  );
}

function AlphaChangesView({
  environmentId,
  experimental_Original: Original,
  experimental_target,
  threadId,
}: ExperimentalChangesViewProps) {
  const [embedOriginal, setEmbedOriginal] = useState(false);
  const [shouldCrash, setShouldCrash] = useState(false);
  if (shouldCrash) throw new Error("Alpha Changes-view test crash");

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar text-foreground">
      <LabHeader
        kind="Changes view"
        embedOriginal={embedOriginal}
        onEmbedOriginalChange={setEmbedOriginal}
        onCrash={() => setShouldCrash(true)}
      />
      {embedOriginal ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <Original />
        </div>
      ) : (
        <div className="space-y-3 overflow-auto p-4 text-xs">
          <p className="rounded-md border border-border bg-muted/30 p-3">
            Alpha owns the complete Changes toolbar and body.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-muted-foreground">
            <dt>Thread</dt>
            <dd className="truncate font-mono">{threadId}</dd>
            <dt>Environment</dt>
            <dd className="truncate font-mono">{environmentId}</dd>
            <dt>Target</dt>
            <dd className="truncate font-mono">
              {experimental_target === null
                ? "none"
                : experimental_target.target.kind === "file"
                  ? `file:${experimental_target.target.path}`
                  : `commit:${experimental_target.target.sha}`}
            </dd>
          </dl>
          {experimental_target === null ? null : (
            <button
              type="button"
              className="rounded border border-border px-2 py-1 hover:bg-muted"
              onClick={experimental_target.clear}
            >
              Clear target
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function AlphaFileOpener({
  Original,
  path,
  source,
}: PluginFileOpenerProps) {
  const [embedOriginal, setEmbedOriginal] = useState(false);
  const [shouldCrash, setShouldCrash] = useState(false);
  if (shouldCrash) throw new Error("Alpha file-opener test crash");

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      <LabHeader
        kind="File opener"
        embedOriginal={embedOriginal}
        onEmbedOriginalChange={setEmbedOriginal}
        onCrash={() => setShouldCrash(true)}
      />
      <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span className="font-mono text-foreground">{path}</span>
        <span className="ml-2">({source.kind})</span>
      </div>
      {embedOriginal ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <Original />
        </div>
      ) : (
        <div className="grid flex-1 place-items-center p-6 text-center">
          <div>
            <p className="text-lg font-medium">Alpha Markdown renderer</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Use Settings → Files to switch providers.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function LabHeader({
  embedOriginal,
  kind,
  onCrash,
  onEmbedOriginalChange,
}: {
  embedOriginal: boolean;
  kind: string;
  onCrash: () => void;
  onEmbedOriginalChange: (next: boolean) => void;
}) {
  return (
    <header className="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-2 text-xs">
      <strong className="mr-auto">
        {LABEL} · {kind}
      </strong>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={embedOriginal}
          onChange={(event) => onEmbedOriginalChange(event.target.checked)}
        />
        Embed BB original
      </label>
      <button
        type="button"
        className="rounded border border-border px-2 py-1 hover:bg-muted"
        onClick={onCrash}
      >
        Crash
      </button>
    </header>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: "alpha-navigation",
    title: "Replacement Lab Alpha",
    description: "Test host-owned sidebar navigation replacement.",
    component: AlphaSidebarNavigation,
  });
  app.slots.experimental_threadList({
    id: "alpha-list",
    title: "Replacement Lab Alpha",
    description: "Test provider Alpha.",
    component: AlphaThreadList,
  });
  app.slots.experimental_changesView({
    id: "alpha-changes",
    title: "Replacement Lab Alpha",
    description: "Test whole-Changes provider Alpha.",
    component: AlphaChangesView,
  });
  app.slots.fileOpener({
    id: "alpha-markdown",
    title: "Alpha Markdown",
    extensions: ["md", "mdx"],
    component: AlphaFileOpener,
  });
});
