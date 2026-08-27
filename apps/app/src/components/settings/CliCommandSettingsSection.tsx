import { useCallback, useEffect, useState } from "react";
import type { BbDesktopCliCommandStatus } from "@bb/desktop-contract";
import { Button } from "@bb/shared-ui/button";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { appToast } from "@/components/ui/app-toast";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

/**
 * Put this app's own bb on the user's PATH, and show when something else would
 * win. An npm-global or Homebrew bb shadowing ours is the "silently runs the
 * wrong bb" failure the feature exists to prevent, so it is displayed rather
 * than documented away.
 *
 * Gated on the desktop bridge exposing `cliCommand`, the feature-detect idiom
 * used elsewhere in bb-desktop.ts, so the web build and older desktop shells
 * render nothing.
 */
function statusBadge(status: BbDesktopCliCommandStatus | null): string | null {
  if (status === null) return null;
  if (!status.wrapperInstalled) return "Not installed";
  if (!status.onPath) return "Not on PATH";
  if (!status.ownEntryWins) return "Shadowed";
  return "Installed";
}

function description(status: BbDesktopCliCommandStatus | null): string {
  if (status === null) {
    return "Install this app's bb command so the bb you type is the bb this app runs.";
  }
  if (!status.wrapperInstalled) {
    return `Install \`${status.commandName}\` into ${status.binDir} so the bb you type is the bb this app runs.`;
  }
  if (!status.onPath) {
    return `Installed at ${status.binDir}. Add it to your shell profile: export PATH="$HOME/.bb/bin:$PATH"`;
  }
  if (!status.ownEntryWins) {
    return `Another ${status.commandName} comes first on PATH: ${status.matches[0]}. Move ${status.binDir} ahead of it.`;
  }
  return `\`${status.commandName}\` resolves to this app, from ${status.binDir}.`;
}

export function CliCommandSettingsSection() {
  const api = getBbDesktopInfo()?.cliCommand;
  const [status, setStatus] = useState<BbDesktopCliCommandStatus | null>(null);
  const [pending, setPending] = useState(false);
  const badge = statusBadge(status);

  useEffect(() => {
    if (api === undefined) return;
    void api.getStatus().then(setStatus);
  }, [api]);

  const install = useCallback(() => {
    if (api === undefined) return;
    setPending(true);
    api
      .install()
      .then((next) => {
        setStatus(next);
        appToast.success(`Installed ${next.commandName} in ${next.binDir}`);
      })
      .catch((error: unknown) => {
        appToast.error(
          error instanceof Error ? error.message : "Could not install the command",
        );
      })
      .finally(() => setPending(false));
  }, [api]);

  if (api === undefined) {
    return null;
  }

  return (
    <SettingsSection title="Command line">
      <SettingsWithControl
        label="bb command"
        {...(badge === null ? {} : { labelBadge: badge })}
        description={description(status)}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={install}
          aria-label="Install the bb command"
        >
          {pending ? "Installing…" : status?.wrapperInstalled ? "Repair" : "Install"}
        </Button>
      </SettingsWithControl>
    </SettingsSection>
  );
}
