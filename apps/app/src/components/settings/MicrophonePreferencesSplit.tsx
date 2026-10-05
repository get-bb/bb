import { Skeleton } from "@bb/shared-ui/skeleton";
import { defineSplit } from "@/lib/define-split";

export const MicrophonePreferencesSplit = defineSplit<{
  open: boolean;
  activeStream: MediaStream | null;
  onCaptureReady?: () => void;
}>({
  id: "microphone-preferences",
  load: () =>
    import("./MicrophonePreferences").then(
      (module) => module.MicrophonePreferences,
    ),
  loading: () => (
    <Skeleton className="h-24 w-full" aria-label="Loading microphones" />
  ),
  preload: "intent",
});
