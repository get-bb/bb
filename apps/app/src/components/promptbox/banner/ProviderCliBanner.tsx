import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { ProviderRequirementBanner } from "./ProviderRequirementBanner";

interface ProviderCliBannerProps {
  displayName: string;
  installed: boolean;
  currentVersion: string | null;
  minimumSupportedVersion: string | null;
  canRunAction: boolean;
  actionRunning: boolean;
  onAction: () => void;
}

function versionRequirementCopy(
  currentVersion: string | null,
  minimumSupportedVersion: string | null,
): string {
  if (currentVersion !== null && minimumSupportedVersion !== null) {
    return `Installed ${currentVersion}; version ${minimumSupportedVersion} or newer is required.`;
  }
  if (currentVersion !== null) {
    return `Installed ${currentVersion}; a newer version is required.`;
  }
  if (minimumSupportedVersion !== null) {
    return `Version ${minimumSupportedVersion} or newer is required.`;
  }
  return "A newer version is required.";
}

export function providerCliBlockedReason({
  displayName,
  installed,
}: {
  displayName: string;
  installed: boolean;
}): string {
  return `${installed ? "Update" : "Install"} ${displayName} before starting a thread.`;
}

export function ProviderCliBanner({
  displayName,
  installed,
  currentVersion,
  minimumSupportedVersion,
  canRunAction,
  actionRunning,
  onAction,
}: ProviderCliBannerProps) {
  const blockedReason = providerCliBlockedReason({ displayName, installed });
  return (
    <ProviderRequirementBanner
      title={
        installed
          ? `${displayName} update required`
          : `${displayName} not installed`
      }
      description={
        installed ? (
          <>
            {blockedReason}{" "}
            {versionRequirementCopy(currentVersion, minimumSupportedVersion)}
          </>
        ) : (
          blockedReason
        )
      }
      action={
        canRunAction ? (
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 px-3"
            disabled={actionRunning}
            onClick={onAction}
          >
            {actionRunning ? (
              <>
                <Icon name="Spinner" className="animate-spin" />
                {installed ? "Updating…" : "Installing…"}
              </>
            ) : (
              `${installed ? "Update" : "Install"} ${displayName}`
            )}
          </Button>
        ) : null
      }
    />
  );
}
