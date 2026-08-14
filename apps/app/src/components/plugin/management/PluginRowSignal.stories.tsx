import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { PluginRowSignalView } from "./PluginRowSignal";
import { UpdatePluginDialog } from "./UpdatePluginDialog";

export default {
  title: "plugin/Row Signal",
};

const FULL_HASH = "a985e1d5523398e9c7459d35679142cc4339771e";

const GIT_PLUGIN = {
  id: "prompt-shaper",
  source:
    "git:https://github.com/brsbl/bb-plugins.git@1c6bb2e8ad3551466981e7eb027cc4b1f3428cac",
  rootDir: "/home/user/.bb/plugins/prompt-shaper",
  version: "0.1.0",
  enabled: true,
  status: "running",
  statusDetail: null,
  description: "Enhance a rough composer draft before sending it.",
  name: "Prompt Improver",
  icon: "AiContentGenerator01",
  compactIconUrl: null,
  logoUrl: null,
  logoDarkUrl: null,
  hasSettings: false,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  capabilities: [],
  app: { hasApp: true, bundle: null },
  provenance: "catalog" as const,
  isOrphanedBuiltin: false,
  catalogEntryId: "prompt-shaper",
  publisherLabel: "BB Community",
  sourceDisplay: "git · github.com/brsbl/bb-plugins",
  updateState: { ...EMPTY_PLUGIN_UPDATE_STATE, availableVersion: FULL_HASH },
} satisfies PluginListItem;

function StateRow({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex min-h-7 items-center">{children}</span>
    </div>
  );
}

/**
 * Every state of the installed row's status/action slot around updates,
 * following the multi-state pattern: scroll one story, review the surface.
 * The control is a quiet neutral button whose tinted up-arrow carries the
 * tone; it names a version only when the version is readable — git sources
 * report commit hashes, which belong (shortened) in the dialog, not the row.
 */
export const UpdateStates = () => (
  <div className="flex max-w-xl flex-col gap-3 p-4">
    <StateRow label="Semver update — button names the version">
      <PluginRowSignalView
        signal={{ kind: "update", version: "1.2.0" }}
        onUpdateClick={() => {}}
        onStatusClick={() => {}}
      />
    </StateRow>
    <StateRow label="Git update — hash never shows in the row">
      <PluginRowSignalView
        signal={{ kind: "update", version: FULL_HASH }}
        onUpdateClick={() => {}}
        onStatusClick={() => {}}
      />
    </StateRow>
    <StateRow label="No update available — the slot stays empty">
      {/* pluginRowSignal() returns null here; the row renders nothing. */}
    </StateRow>
    <StateRow label="Status signal (unrelated failure) keeps its tone">
      <PluginRowSignalView
        signal={{
          kind: "status",
          icon: "AlertTriangle",
          label: "Update failed",
          tone: "error",
          detail: "Rolled back to 0.1.0",
        }}
        onUpdateClick={() => {}}
        onStatusClick={() => {}}
      />
    </StateRow>
  </div>
);

/**
 * The confirmation dialog for a git-sourced update: the title and rollback
 * note shorten the commit hash to seven characters, while the collapsed
 * details grid keeps the full value for precision.
 */
export const UpdateDialogShortHash = () => {
  const [queryClient] = useState(() => new QueryClient());
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={queryClient}>
      <div className="p-4">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm"
          onClick={() => setOpen(true)}
        >
          Reopen dialog
        </button>
        <UpdatePluginDialog
          plugin={GIT_PLUGIN}
          open={open}
          onOpenChange={setOpen}
        />
      </div>
    </QueryClientProvider>
  );
};
