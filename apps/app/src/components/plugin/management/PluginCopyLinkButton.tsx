import type { PluginLinkTarget } from "@bb/client-core";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
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
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-label={`Copy link to ${displayName}`}
      className="h-7 shrink-0 gap-1.5 px-2.5 text-xs shadow-none"
      onClick={() => void copyPluginLink(target)}
    >
      <Icon name="Link" className="size-3.5" aria-hidden />
      Copy link
    </Button>
  );
}
