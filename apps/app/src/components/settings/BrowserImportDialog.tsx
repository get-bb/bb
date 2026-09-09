import { useEffect, useRef, useState } from "react";
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
  formatCookieCount,
  formatSkippedDomains,
  initialBrowserImportStep,
  outcomeToBrowserImportStep,
  preferredSourceProfileDirectory,
  refreshedBrowserImportStep,
  type BrowserImportWizardStep,
} from "./browser-import-wizard";

export interface BrowserImportDialogProps {
  source: DesktopBrowserImportSource;
  desktopBrowser: BbDesktopBrowserApi;
  onClose: () => void;
  onImported: () => void;
}

const TILE_CLASS =
  "flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-state-hover";
const TILE_SELECTED_CLASS =
  "border-surface-selected-border bg-surface-selected";
const TILE_IDLE_CLASS = "border-border";

export function BrowserImportDialog({
  source: initialSource,
  desktopBrowser,
  onClose,
  onImported,
}: BrowserImportDialogProps) {
  const [source, setSource] = useState(initialSource);
  const [step, setStep] = useState<BrowserImportWizardStep>(() =>
    initialBrowserImportStep(initialSource),
  );
  const [sourceProfileDirectory, setSourceProfileDirectory] = useState<
    string | null
  >(() => preferredSourceProfileDirectory(null, initialSource));
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runImport = () => {
    if (sourceProfileDirectory === null || !desktopBrowser.importCookies) {
      setStep({ step: "blocked", reason: "unknownSourceProfile" });
      return;
    }
    setStep({ step: "importing" });
    desktopBrowser
      .importCookies({
        sourceId: source.id,
        sourceProfileDirectory,
        profile: { kind: "personal" },
      })
      .then((outcome: DesktopBrowserImportOutcome) => {
        if (!mounted.current) return;
        if (outcome.ok) onImported();
        setStep(outcomeToBrowserImportStep(outcome));
      })
      .catch(() => {
        if (mounted.current) setStep({ step: "blocked", reason: "readFailed" });
      });
  };

  const recheck = () => {
    if (!desktopBrowser.listImportSources) return;
    const previous = step;
    setStep({ step: "checking" });
    desktopBrowser
      .listImportSources()
      .then((result) => {
        if (!mounted.current) return;
        const refreshed = result.sources.find(
          (candidate) => candidate.id === source.id,
        );
        if (refreshed) {
          setSource(refreshed);
          setSourceProfileDirectory((current) =>
            preferredSourceProfileDirectory(current, refreshed),
          );
        }
        setStep(refreshedBrowserImportStep(refreshed, previous));
      })
      .catch(() => {
        if (mounted.current) setStep({ step: "blocked", reason: "readFailed" });
      });
  };

  const closable = canCloseBrowserImportWizard(step);
  const selectedProfile = source.profiles.find(
    (profile) => profile.directory === sourceProfileDirectory,
  );

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
        {step.step === "quit" ? (
          <>
            <DialogHeader>
              <DialogTitle>Quit {source.name} to import</DialogTitle>
              <DialogDescription>
                {source.name} is open, so its cookie database is locked. Quit
                it, then continue.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={recheck}>I've quit it</Button>
            </DialogFooter>
          </>
        ) : step.step === "fullDiskAccess" ? (
          <>
            <DialogHeader>
              <DialogTitle>Allow Full Disk Access for Safari</DialogTitle>
              <DialogDescription>
                Safari keeps its cookies in a protected folder. Turn on Full
                Disk Access for BB in System Settings → Privacy &amp; Security,
                then come back. You can turn it off again after the import.
              </DialogDescription>
            </DialogHeader>
            {step.checked ? (
              <p className="text-xs text-destructive-text">
                Full Disk Access is still off. macOS may require quitting and
                reopening BB before the grant applies.
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
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
            <DialogTitle>Checking {source.name}…</DialogTitle>
            <DialogDescription>This only takes a moment.</DialogDescription>
          </DialogHeader>
        ) : step.step === "importing" ? (
          <DialogHeader>
            <DialogTitle>Importing from {source.name}…</DialogTitle>
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
                  ? `Added to your personal BB browser from ${source.name}${selectedProfile ? ` · ${selectedProfile.name}` : ""}.${step.skipped > 0 ? ` ${formatCookieCount(step.skipped)} skipped.` : ""}`
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
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : step.step === "blocked" ? (
          <>
            <DialogHeader>
              <DialogTitle>Can't import from {source.name}</DialogTitle>
              <DialogDescription>
                {DESKTOP_BROWSER_IMPORT_FAILURE_COPY[step.reason]}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              {isRetryableDesktopBrowserImportReason(step.reason) ? (
                <Button onClick={recheck}>Try again</Button>
              ) : null}
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Import from {source.name}</DialogTitle>
              <DialogDescription>
                Choose which profile's cookies to copy into your personal BB
                browser. This is a one-time copy; later logins stay separate.
              </DialogDescription>
            </DialogHeader>
            <div
              role="radiogroup"
              aria-label="Source profile"
              className="flex flex-col gap-1.5"
            >
              {source.profiles.map((profile) => {
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
