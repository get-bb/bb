import { durationToCompactString } from "@bb/thread-view";
import { useSecondTick } from "@/hooks/useSecondTick";

export function LiveDurationText({ startedAt }: { startedAt: number }) {
  const elapsedMs = useSecondTick() - startedAt;

  if (elapsedMs <= 1_000) return null;
  return <>{durationToCompactString(elapsedMs)}</>;
}
