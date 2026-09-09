import { useState } from "react";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import { Button } from "@bb/shared-ui/button";
import { SettingsSection } from "@/components/ui/settings-section";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { BrowserImportDialog } from "./BrowserImportDialog";

export interface BrowserSettingsSectionContentProps {
  desktopBrowser: BbDesktopBrowserApi | null;
}

export function BrowserSettingsSectionContent({
  desktopBrowser,
}: BrowserSettingsSectionContentProps) {
  const supported = desktopBrowser?.listImportSources !== undefined;
  const [open, setOpen] = useState(false);
  const [lastImport, setLastImport] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Signed-in sessions"
        description="Copy cookies from a browser on this machine into the BB browser so previews and agent tabs open already logged in."
        actionPlacement="inline"
        action={
          supported ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              Import cookies…
            </Button>
          ) : undefined
        }
      >
        {!supported ? (
          <p className="text-sm text-subtle-foreground">
            Only available in the BB desktop app.
          </p>
        ) : (
          <div className="space-y-1">
            <p className="text-sm text-foreground">
              Import detects Chrome, Chromium, Edge, Brave, Vivaldi, Opera, Arc,
              Firefox, and Safari and lets you pick a browser and profile.
            </p>
            <p className="text-xs text-subtle-foreground">
              {lastImport ??
                "A one-time copy. Later logins in either browser stay separate, and some sites will still ask you to sign in again."}
            </p>
          </div>
        )}
      </SettingsSection>
      {supported ? (
        <p className="text-xs text-subtle-foreground">
          Also available from the CLI: <code>bb browser import-sources</code>{" "}
          and <code>bb browser import-cookies</code>.
        </p>
      ) : null}
      {open && desktopBrowser ? (
        <BrowserImportDialog
          desktopBrowser={desktopBrowser}
          onClose={() => setOpen(false)}
          onImported={(source) =>
            setLastImport(
              `Last import: ${source.name}, ${new Date().toLocaleString()}.`,
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
