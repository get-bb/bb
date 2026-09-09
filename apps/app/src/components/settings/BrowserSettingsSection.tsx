import { useCallback, useEffect, useState } from "react";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import type { DesktopBrowserImportSource } from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { BrowserImportDialog } from "./BrowserImportDialog";
import {
  describeSourceProfiles,
  isSourceListed,
} from "./browser-import-wizard";

type SourcesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sources: DesktopBrowserImportSource[] };

const STATUS_CHIP_CLASS =
  "shrink-0 rounded-full border px-2 py-0.5 text-2xs leading-none";

function statusChip(source: DesktopBrowserImportSource): {
  label: string;
  className: string;
} {
  switch (source.unavailable) {
    case undefined:
      return {
        label: "Ready",
        className: "border-success/40 bg-success/10 text-success-foreground",
      };
    case "browserRunning":
      return {
        label: "Quit first",
        className: "border-warning/50 bg-warning/10 text-warning-text",
      };
    case "needsFullDiskAccess":
      return {
        label: "Needs permission",
        className: "border-warning/50 bg-warning/10 text-warning-text",
      };
    case "notInstalled":
      return {
        label: "Not installed",
        className: "border-border bg-muted/40 text-subtle-foreground",
      };
    default:
      return {
        label: "Unavailable",
        className: "border-border bg-muted/40 text-subtle-foreground",
      };
  }
}

export interface BrowserSettingsSectionContentProps {
  desktopBrowser: BbDesktopBrowserApi | null;
}

export function BrowserSettingsSectionContent({
  desktopBrowser,
}: BrowserSettingsSectionContentProps) {
  const supported = desktopBrowser?.listImportSources !== undefined;
  const [state, setState] = useState<SourcesState>({ status: "loading" });
  const [activeSource, setActiveSource] =
    useState<DesktopBrowserImportSource | null>(null);
  const [lastImport, setLastImport] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!desktopBrowser?.listImportSources) return;
    setState({ status: "loading" });
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

  const listed =
    state.status === "ready" ? state.sources.filter(isSourceListed) : [];

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Import cookies from another browser"
        description="Copy signed-in sessions from a browser on this machine into your personal BB browser so previews open already logged in. This is a one-time copy; later logins stay separate."
        actionPlacement="inline"
        action={
          supported ? (
            <Button
              variant="outline"
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
          <p className="text-sm text-subtle-foreground">
            Checking installed browsers…
          </p>
        ) : state.status === "error" ? (
          <p className="text-sm text-destructive-text">{state.message}</p>
        ) : listed.length === 0 ? (
          <p className="text-sm text-subtle-foreground">
            No supported browsers were found on this machine.
          </p>
        ) : (
          <SettingsRowList>
            {listed.map((source) => {
              const chip = statusChip(source);
              const importable =
                source.unavailable === undefined ||
                source.unavailable === "browserRunning" ||
                source.unavailable === "needsFullDiskAccess";
              return (
                <SettingsRow
                  key={source.id}
                  data-testid={`browser-import-${source.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {source.name}
                      </p>
                      <span className={cn(STATUS_CHIP_CLASS, chip.className)}>
                        {chip.label}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-subtle-foreground">
                      {describeSourceProfiles(source)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={
                      source.unavailable === undefined ? "default" : "outline"
                    }
                    disabled={!importable}
                    onClick={() => setActiveSource(source)}
                  >
                    {source.unavailable === "needsFullDiskAccess"
                      ? "Grant & import…"
                      : "Import…"}
                  </Button>
                </SettingsRow>
              );
            })}
          </SettingsRowList>
        )}
        {lastImport ? (
          <p className="mt-3 text-xs text-subtle-foreground">{lastImport}</p>
        ) : null}
      </SettingsSection>
      {supported ? (
        <p className="text-xs text-subtle-foreground">
          Also available from the CLI: <code>bb browser import-sources</code>{" "}
          and <code>bb browser import-cookies</code>.
        </p>
      ) : null}
      {activeSource && desktopBrowser ? (
        <BrowserImportDialog
          key={activeSource.id}
          source={activeSource}
          desktopBrowser={desktopBrowser}
          onClose={() => {
            setActiveSource(null);
            refresh();
          }}
          onImported={() =>
            setLastImport(
              `Last import: ${activeSource.name}, ${new Date().toLocaleString()}.`,
            )
          }
        />
      ) : null}
    </div>
  );
}

export function BrowserSettingsSection() {
  const [desktopBrowser] = useState(getDesktopBrowserApi);
  return <BrowserSettingsSectionContent desktopBrowser={desktopBrowser} />;
}
