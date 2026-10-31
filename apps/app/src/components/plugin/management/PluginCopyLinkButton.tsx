import type { PluginLinkTarget } from "@bb/client-core";
import { ResourceActionButton } from "@bb/shared-ui/resource-list";
import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";
import { copyToClipboardWithToast } from "@/lib/clipboard";

async function copyPluginLink(target: PluginLinkTarget): Promise<void> {
  const copied = await copyToClipboardWithToast(target.url, {
    successMessage: "Link copied",
    errorMessage: "Failed to copy link.",
  });
  if (!copied) return;
  recordTelemetryEvent({
    name: "plugin_link_shared",
    properties: {
      entry_id: target.entryId,
      marketplace: target.marketplace,
      share_method: "copy_link",
    },
  });
}

export function PluginCopyLinkButton({
  target,
  displayName,
}: {
  target: PluginLinkTarget | null;
  displayName: string;
}) {
  if (target === null) return null;
  return (
    <ResourceActionButton
      label={`Copy link to ${displayName}`}
      tooltipLabel="Copy link"
      icon="Link"
      onClick={() => void copyPluginLink(target)}
    />
  );
}
