import type { PluginShareTarget } from "@bb/client-core";
import type { PluginShareMethod } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import type { ResourceOverflowMenuItem } from "@bb/shared-ui/resource-list";
import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";
import { copyToClipboardWithToast } from "@/lib/clipboard";

function recordPluginLinkShared(
  target: PluginShareTarget,
  method: PluginShareMethod,
): void {
  recordTelemetryEvent({
    name: "plugin_link_shared",
    properties: {
      entry_id: target.entryId,
      marketplace: target.marketplace,
      share_method: method,
    },
  });
}

function shareSheetAvailable(): boolean {
  return (
    typeof navigator.share === "function" &&
    window.matchMedia(POINTER_COARSE_QUERY).matches
  );
}

async function copyPluginLink(target: PluginShareTarget): Promise<void> {
  const copied = await copyToClipboardWithToast(target.url, {
    successMessage: "Link copied",
    errorMessage: "Failed to copy link.",
  });
  if (copied) recordPluginLinkShared(target, "copy_link");
}

export async function sharePluginLink(
  target: PluginShareTarget,
  title: string,
): Promise<void> {
  if (!shareSheetAvailable()) {
    await copyPluginLink(target);
    return;
  }
  try {
    await navigator.share({ title, url: target.url });
  } catch {
    return;
  }
  recordPluginLinkShared(target, "share_sheet");
}

export function copyMarketplaceLinkItems(
  target: PluginShareTarget | null,
): ResourceOverflowMenuItem[] {
  if (target === null) return [];
  return [
    {
      label: "Copy marketplace link",
      icon: "Copy",
      onSelect: () => void copyPluginLink(target),
    },
  ];
}

export function PluginShareButton({
  target,
  displayName,
}: {
  target: PluginShareTarget | null;
  displayName: string;
}) {
  if (target === null) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`Share ${displayName}`}
      className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
      onClick={() => void sharePluginLink(target, displayName)}
    >
      <Icon name="Share" className="size-3.5" aria-hidden />
      Share
    </Button>
  );
}
