import { useCallback, useEffect, useState } from "react";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import {
  DESKTOP_BROWSER_IMPORT_FAILURE_COPY,
  type DesktopBrowserImportOutcome,
  type DesktopBrowserImportSource,
} from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import { appToast } from "@/components/ui/app-toast";
import {
  SettingsBadge,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { formatRelativeTime } from "@/lib/relative-time";
import { BrowserImportDialog } from "./BrowserImportDialog";
import { BrowserSourceIcon } from "./BrowserSourceIcon";
import {
  BROWSER_IMPORT_RECORDS_STORAGE_KEY,
  formatCookieCount,
  listedSources,
  needsProfileChoice,
  presentSourceRow,
  readBrowserImportRecords,
  recordFromOutcome,
  sourceAfterFailure,
  type BrowserImportRecords,
  type SourceRowTone,
} from "./browser-import-wizard";

type SourcesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sources: DesktopBrowserImportSource[] };

const DOT_TONE_CLASS: Record<SourceRowTone, string> = {
  ready: "bg-success",
  attention: "bg-warning",
  idle: "border border-muted-foreground",
};

function localStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

interface BrowserRowProps {
  source: DesktopBrowserImportSource;
  record: BrowserImportRecords[DesktopBrowserImportSource["id"]];
  now: number;
  pending: boolean;
  onImport: () => void;
  onRecheck: () => void;
}

function BrowserRow({
  source,
  record,
  now,
  pending,
  onImport,
  onRecheck,
}: BrowserRowProps) {
  const presentation = presentSourceRow(source, record);
  const actionable = presentation.action !== "none";
  return (
    <SettingsRow data-testid={`browser-import-${source.id}`}>
      <div className="group -mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5">
        <BrowserSourceIcon source={source} className="size-7 rounded-[7px]" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {source.name}
            </span>
            {record ? (
              <SettingsBadge>
                imported {formatRelativeTime({ timestamp: record.at, now })}
              </SettingsBadge>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-subtle-foreground/75">
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5",
                presentation.tone === "attention" && "text-warning-text",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  DOT_TONE_CLASS[presentation.tone],
                )}
              />
              {presentation.status}
            </span>
            {presentation.details.map((detail) => (
              <span key={detail} className="min-w-0 truncate">
                {detail}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={!actionable || pending}
            onClick={presentation.action === "recheck" ? onRecheck : onImport}
          >
            {presentation.actionLabel}
          </Button>
        </div>
      </div>
    </SettingsRow>
  );
}

export interface BrowserSettingsSectionContentProps {
  desktopBrowser: BbDesktopBrowserApi | null;
}

export function BrowserSettingsSectionContent({
  desktopBrowser,
}: BrowserSettingsSectionContentProps) {
  const supported = desktopBrowser?.listImportSources !== undefined;
  const [state, setState] = useState<SourcesState>({ status: "loading" });
  const [records, setRecords] = useState<BrowserImportRecords>(() =>
    readBrowserImportRecords(localStorageOrNull()),
  );
  const [dialogSource, setDialogSource] =
    useState<DesktopBrowserImportSource | null>(null);
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!desktopBrowser?.listImportSources) return;
    setState((current) =>
      current.status === "ready" ? current : { status: "loading" },
    );
    desktopBrowser
      .listImportSources()
      .then((result) => setState({ status: "ready", sources: result.sources }))
      .catch((error: unknown) =>
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not check installed browsers.",
        }),
      );
  }, [desktopBrowser]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const recordImport = (
    source: DesktopBrowserImportSource,
    profileName: string,
    outcome: DesktopBrowserImportOutcome & { ok: true },
  ) => {
    const next: BrowserImportRecords = {
      ...records,
      [source.id]: recordFromOutcome(outcome, profileName, Date.now()),
    };
    setRecords(next);
    try {
      localStorageOrNull()?.setItem(
        BROWSER_IMPORT_RECORDS_STORAGE_KEY,
        JSON.stringify(next),
      );
    } catch {
      return;
    }
    appToast.success(
      outcome.imported > 0
        ? `Imported ${formatCookieCount(outcome.imported)} from ${source.name}`
        : `No cookies were imported from ${source.name}`,
    );
  };

  const importDirectly = (source: DesktopBrowserImportSource) => {
    const profile = source.profiles[0];
    if (!profile || !desktopBrowser?.importCookies) {
      setDialogSource(source);
      return;
    }
    setPendingSourceId(source.id);
    desktopBrowser
      .importCookies({
        sourceId: source.id,
        sourceProfileDirectory: profile.directory,
        profile: { kind: "personal" },
      })
      .then((outcome) => {
        if (outcome.ok) {
          recordImport(source, profile.name, outcome);
          return;
        }
        const blocked = sourceAfterFailure(source, outcome.reason);
        if (blocked) setDialogSource(blocked);
        else
          appToast.error(
            `${source.name}: ${DESKTOP_BROWSER_IMPORT_FAILURE_COPY[outcome.reason]}`,
          );
      })
      .catch(() => {
        appToast.error(`Could not read ${source.name}'s cookies.`);
      })
      .finally(() => {
        setPendingSourceId(null);
        refresh();
      });
  };

  const listed = state.status === "ready" ? listedSources(state.sources) : [];
  const now = Date.now();

  return (
    <>
      <SettingsSection
        title="Browsers"
        description="Bring signed-in sessions from a browser on this machine into the BB browser, so previews and agent tabs open already logged in."
        action={
          supported ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={state.status === "loading"}
            >
              Refresh
            </Button>
          ) : undefined
        }
      >
        {!supported ? (
          <p className="text-sm text-subtle-foreground">
            Only available in the BB desktop app.
          </p>
        ) : state.status === "loading" ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : state.status === "error" ? (
          <p className="text-sm text-destructive-text">{state.message}</p>
        ) : listed.length === 0 ? (
          <p className="text-sm text-subtle-foreground">
            No supported browsers were found on this machine.
          </p>
        ) : (
          <SettingsRowList>
            {listed.map((source) => (
              <BrowserRow
                key={source.id}
                source={source}
                record={records[source.id]}
                now={now}
                pending={pendingSourceId === source.id}
                onRecheck={refresh}
                onImport={() => {
                  if (needsProfileChoice(source)) setDialogSource(source);
                  else if (source.unavailable === undefined)
                    importDirectly(source);
                  else setDialogSource(source);
                }}
              />
            ))}
          </SettingsRowList>
        )}
      </SettingsSection>
      {supported ? (
        <p className="mt-4 text-xs text-subtle-foreground/75">
          Also from the CLI: <code>bb browser import-sources</code> and{" "}
          <code>bb browser import-cookies</code>.
        </p>
      ) : null}
      {dialogSource && desktopBrowser ? (
        <BrowserImportDialog
          key={`${dialogSource.id}:${dialogSource.unavailable ?? "ready"}`}
          source={dialogSource}
          desktopBrowser={desktopBrowser}
          onClose={() => {
            setDialogSource(null);
            refresh();
          }}
          onImported={recordImport}
        />
      ) : null}
    </>
  );
}

export function BrowserSettingsSection() {
  const [desktopBrowser] = useState(getDesktopBrowserApi);
  return <BrowserSettingsSectionContent desktopBrowser={desktopBrowser} />;
}
