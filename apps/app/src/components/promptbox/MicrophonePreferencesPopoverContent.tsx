import type { ComponentProps } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { PopoverContent } from "@bb/shared-ui/popover";
import { MicrophonePreferencesSplit } from "./MicrophonePreferencesSplit";

export function MicrophonePreferencesPopoverContent({
  open,
  onClose,
  warning,
  onCaptureReady,
  ...props
}: ComponentProps<typeof PopoverContent> & {
  open: boolean;
  onClose: () => void;
  warning: string | null;
  onCaptureReady?: () => void;
}) {
  return (
    <PopoverContent
      aria-label="Voice preferences"
      mobileTitle="Voice preferences"
      sideOffset={8}
      className="w-80 rounded-xl p-4 shadow-lg"
      {...props}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Microphone</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close voice preferences"
            onClick={onClose}
          >
            <Icon name="X" className="size-4" />
          </Button>
        </div>
        {warning ? (
          <p role="status" className="text-sm text-destructive">
            {warning}
          </p>
        ) : null}
        <MicrophonePreferencesSplit
          open={open}
          onCaptureReady={onCaptureReady}
        />
      </div>
    </PopoverContent>
  );
}
