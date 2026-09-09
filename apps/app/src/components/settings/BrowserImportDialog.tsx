import { useCallback, useEffect, useRef, useState } from "react";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import {
  DESKTOP_BROWSER_IMPORT_FAILURE_COPY,
  isRetryableDesktopBrowserImportReason,
  type DesktopBrowserImportOutcome,
  type DesktopBrowserImportSource,
} from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  canCloseBrowserImportWizard,
  canReturnToSourceChoice,
  describeSourceProfiles,
  detectedSources,
  formatCookieCount,
  formatSkippedDomains,
  initialBrowserImportStep,
  isSourceSelectable,
  outcomeToBrowserImportStep,
  preferredSourceProfileDirectory,
  refreshedBrowserImportStep,
  sourceStatus,
  type BrowserImportWizardStep,
  type SourceStatusTone,
} from "./browser-import-wizard";

export interface BrowserImportDialogProps {
  desktopBrowser: BbDesktopBrowserApi;
  onClose: () => void;
  onImported: (source: DesktopBrowserImportSource) => void;
}

const TILE_CLASS =
  "flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-state-hover disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent";
const TILE_SELECTED_CLASS =
  "border-surface-selected-border bg-surface-selected";
const TILE_IDLE_CLASS = "border-border";
const STATUS_CHIP_CLASS =
  "shrink-0 rounded-full border px-2 py-0.5 text-2xs leading-none";
const STATUS_TONE_CLASS: Record<SourceStatusTone, string> = {
  ready: "border-success/40 bg-success/10 text-success-foreground",
  attention: "border-warning/50 bg-warning/10 text-warning-text",
  muted: "border-border bg-muted/40 text-subtle-foreground",
};

export function BrowserImportDialog({
  desktopBrowser,
  onClose,
  onImported,
}: BrowserImportDialogProps) {
  const [sources, setSources] = useState<DesktopBrowserImportSource[]>([]);
  const [source, setSource] = useState<DesktopBrowserImportSource | null>(null);
  const [step, setStep] = useState<BrowserImportWizardStep>({
    step: "detecting",
  });
  const [sourceProfileDirectory, setSourceProfileDirectory] = useState<
    string | null
  >(null);
  const mounted = useRef(true);

  const detect = useCallback(
    (
      next: (
        refreshed: DesktopBrowserImportSource[],
      ) => BrowserImportWizardStep,
    ) => {
      if (!desktopBrowser.listImportSources) {
        setStep({ step: "blocked", reason: "unknownSource" });
        return;
      }
      desktopBrowser
        .listImportSources()
        .then((result) => {
          if (!mounted.current) return;
          setSources(result.sources);
          setStep(next(result.sources));
        })
        .catch(() => {
          if (mounted.current)
            setStep({ step: "blocked", reason: "readFailed" });
        });
    },
    [desktopBrowser],
  );

  useEffect(() => {
    mounted.current = true;
    detect(() => ({ step: "chooseSource" }));
    return () => {
      mounted.current = false;
    };
  }, [detect]);

  const chooseSource = (candidate: DesktopBrowserImportSource) => {
    setSource(candidate);
    setSourceProfileDirectory(preferredSourceProfileDirectory(null, candidate));
    setStep(initialBrowserImportStep(candidate));
  };

  const backToSources = () => {
    setSource(null);
    setStep({ step: "detecting" });
    detect(() => ({ step: "chooseSource" }));
  };

  const runImport = () => {
    if (
      source === null ||
      sourceProfileDirectory === null ||
      !desktopBrowser.importCookies
    ) {
      setStep({ step: "blocked", reason: "unknownSourceProfile" });
      return;
    }
    const target = source;
    setStep({ step: "importing" });
    desktopBrowser
      .importCookies({
        sourceId: target.id,
        sourceProfileDirectory,
        profile: { kind: "personal" },
      })
      .then((outcome: DesktopBrowserImportOutcome) => {
        if (!mounted.current) return;
        if (outcome.ok) onImported(target);
        setStep(outcomeToBrowserImportStep(outcome));
      })
      .catch(() => {
        if (mounted.current) setStep({ step: "blocked", reason: "readFailed" });
      });
  };

  const recheck = () => {
    if (source === null) return;
    const previous = step;
    const id = source.id;
    setStep({ step: "checking" });
    detect((refreshedSources) => {
      const refreshed = refreshedSources.find(
        (candidate) => candidate.id === id,
      );
      if (refreshed) {
        setSource(refreshed);
        setSourceProfileDirectory((current) =>
          preferredSourceProfileDirectory(current, refreshed),
        );
      }
      return refreshedBrowserImportStep(refreshed, previous);
    });
  };

  const closable = canCloseBrowserImportWizard(step);
  const sourceName = source?.name ?? "browser";
  const selectedProfile = source?.profiles.find(
    (profile) => profile.directory === sourceProfileDirectory,
  );
  const detected = detectedSources(sources);
  const backButton = canReturnToSourceChoice(step) ? (
    <Button variant="ghost" onClick={backToSources} className="mr-auto">
      Back
    </Button>
  ) : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && closable) onClose();
      }}
    >
      <DialogContent
        hideCloseButton={!closable}
        onEscapeKeyDown={(event) => {
          if (!closable) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (!closable) event.preventDefault();
        }}
      >
        {step.step === "detecting" ? (
          <DialogHeader>
            <DialogTitle>Looking for browsers…</DialogTitle>
            <DialogDescription>
              Checking which browsers on this machine have cookies to import.
            </DialogDescription>
          </DialogHeader>
        ) : step.step === "chooseSource" ? (
          <>
            <DialogHeader>
              <DialogTitle>Import cookies from another browser</DialogTitle>
              <DialogDescription>
                Choose the browser whose signed-in sessions you want to copy
                into the BB browser. This is a one-time copy; later logins stay
                separate.
              </DialogDescription>
            </DialogHeader>
            {detected.length === 0 ? (
              <p className="text-sm text-subtle-foreground">
                No supported browsers with cookies were found on this machine.
              </p>
            ) : (
              <div
                role="listbox"
                aria-label="Detected browsers"
                className="flex flex-col gap-1.5"
              >
                {detected.map((candidate) => {
                  const status = sourceStatus(candidate);
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      data-testid={`browser-import-source-${candidate.id}`}
                      disabled={!isSourceSelectable(candidate)}
                      className={cn(TILE_CLASS, TILE_IDLE_CLASS)}
                      onClick={() => chooseSource(candidate)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium text-foreground">
                            {candidate.name}
                          </span>
                          <span
                            className={cn(
                              STATUS_CHIP_CLASS,
                              STATUS_TONE_CLASS[status.tone],
                            )}
                          >
                            {status.label}
                          </span>
                        </span>
                        <span className="block truncate text-xs text-subtle-foreground">
                          {describeSourceProfiles(candidate)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={backToSources}>
                Refresh
              </Button>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        ) : step.step === "quit" ? (
          <>
            <DialogHeader>
              <DialogTitle>Quit {sourceName} to import</DialogTitle>
              <DialogDescription>
                {sourceName} is open, so its cookie database is locked. Quit it,
                then continue.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              {backButton}
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={recheck}>I've quit it</Button>
            </DialogFooter>
          </>
        ) : step.step === "fullDiskAccess" ? (
          <>
            <DialogHeader>
              <DialogTitle>Allow Full Disk Access for {sourceName}</DialogTitle>
              <DialogDescription>
                {sourceName} keeps its cookies in a protected folder. Turn on
                Full Disk Access for BB in System Settings → Privacy &amp;
                Security, then come back. You can turn it off again after the
                import.
              </DialogDescription>
            </DialogHeader>
            {step.checked ? (
              <p className="text-xs text-destructive-text">
                Full Disk Access is still off. macOS may require quitting and
                reopening BB before the grant applies.
              </p>
            ) : null}
            <DialogFooter>
              {backButton}
              {desktopBrowser.openFullDiskAccessSettings ? (
                <Button
                  variant="outline"
                  onClick={() => desktopBrowser.openFullDiskAccessSettings?.()}
                >
                  Open System Settings
                </Button>
              ) : null}
              <Button onClick={recheck}>I've turned it on</Button>
            </DialogFooter>
          </>
        ) : step.step === "checking" ? (
          <DialogHeader>
            <DialogTitle>Checking {sourceName}…</DialogTitle>
            <DialogDescription>This only takes a moment.</DialogDescription>
          </DialogHeader>
        ) : step.step === "importing" ? (
          <DialogHeader>
            <DialogTitle>Importing from {sourceName}…</DialogTitle>
            <DialogDescription>
              Reading and decrypting cookies. macOS may ask for Keychain access.
            </DialogDescription>
          </DialogHeader>
        ) : step.step === "done" ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {step.imported > 0
                  ? `Imported ${formatCookieCount(step.imported)}`
                  : step.skipped > 0
                    ? `Skipped ${formatCookieCount(step.skipped)}`
                    : "No cookies found"}
              </DialogTitle>
              <DialogDescription>
                {step.imported > 0
                  ? `Added to your BB browser from ${sourceName}${selectedProfile ? ` · ${selectedProfile.name}` : ""}.${step.skipped > 0 ? ` ${formatCookieCount(step.skipped)} skipped.` : ""}`
                  : step.skipped > 0
                    ? "No cookies were imported."
                    : "There were no cookies to import."}
              </DialogDescription>
            </DialogHeader>
            {step.skippedDomains.length > 0 ? (
              <div>
                <p className="text-2xs font-medium uppercase tracking-wide text-subtle-foreground">
                  Skipped
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {formatSkippedDomains(step.skippedDomains)}
                </p>
                <p className="mt-2 text-xs text-subtle-foreground">
                  Some sites bind sessions to the browser and will ask you to
                  sign in again.
                </p>
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={backToSources}>
                Import another
              </Button>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : step.step === "blocked" ? (
          <>
            <DialogHeader>
              <DialogTitle>Can't import from {sourceName}</DialogTitle>
              <DialogDescription>
                {DESKTOP_BROWSER_IMPORT_FAILURE_COPY[step.reason]}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              {backButton}
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              {source !== null &&
              isRetryableDesktopBrowserImportReason(step.reason) ? (
                <Button onClick={recheck}>Try again</Button>
              ) : null}
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Import from {sourceName}</DialogTitle>
              <DialogDescription>
                Choose which profile's cookies to copy into your BB browser.
              </DialogDescription>
            </DialogHeader>
            <div
              role="radiogroup"
              aria-label="Source profile"
              className="flex flex-col gap-1.5"
            >
              {(source?.profiles ?? []).map((profile) => {
                const selected = profile.directory === sourceProfileDirectory;
                return (
                  <button
                    key={profile.directory}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={cn(
                      TILE_CLASS,
                      selected ? TILE_SELECTED_CLASS : TILE_IDLE_CLASS,
                    )}
                    onClick={() => setSourceProfileDirectory(profile.directory)}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                        selected ? "border-foreground" : "border-border",
                      )}
                    >
                      {selected ? (
                        <span className="size-1.5 rounded-full bg-foreground" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {profile.name}
                      </span>
                      {profile.cookieCount !== undefined ? (
                        <span className="block text-xs text-subtle-foreground">
                          {formatCookieCount(profile.cookieCount)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-subtle-foreground">
              Cookies for the same site replace the ones already in the BB
              browser. macOS may ask for Keychain access to read the browser's
              encryption key; choose Allow to grant it once.
            </p>
            <DialogFooter>
              {backButton}
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={runImport}
                disabled={sourceProfileDirectory === null}
              >
                {selectedProfile?.cookieCount !== undefined
                  ? `Import ${formatCookieCount(selectedProfile.cookieCount)}`
                  : "Import"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
