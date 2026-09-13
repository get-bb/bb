import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { ProviderRequirementBanner } from "./ProviderRequirementBanner";

interface ProviderCliVersionBannerProps {
  displayName: string;
  currentVersion: string | null;
  minimumSupportedVersion: string | null;
  canUpdate: boolean;
  updating: boolean;
  onUpdate: () => void;
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

export function ProviderCliVersionBanner({
  displayName,
  currentVersion,
  minimumSupportedVersion,
  canUpdate,
  updating,
  onUpdate,
}: ProviderCliVersionBannerProps) {
  return (
    <ProviderRequirementBanner
      title={`${displayName} update required`}
      description={
        <>
          Update {displayName} before starting a thread.{" "}
          {versionRequirementCopy(currentVersion, minimumSupportedVersion)}
        </>
      }
      action={
        canUpdate ? (
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 px-3"
            disabled={updating}
            onClick={onUpdate}
          >
            {updating ? (
              <>
                <Icon name="Spinner" className="animate-spin" />
                Updating…
              </>
            ) : (
              `Update ${displayName}`
            )}
          </Button>
        ) : null
      }
    />
  );
}
