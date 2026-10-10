import { useEffect, useState } from "react";

export const SHORT_LIVED_STATUS_DELAY_MS = 1_500;

export function useSustainedFlag(flag: boolean, delayMs: number): boolean {
  const [episode, setEpisode] = useState(0);
  const [previousFlag, setPreviousFlag] = useState(flag);
  const [sustainedEpisode, setSustainedEpisode] = useState<number | null>(
    null,
  );
  if (flag !== previousFlag) {
    setPreviousFlag(flag);
    if (flag) {
      setEpisode(episode + 1);
    }
  }
  useEffect(() => {
    if (!flag) {
      return;
    }
    const timeout = window.setTimeout(
      () => setSustainedEpisode(episode),
      delayMs,
    );
    return () => window.clearTimeout(timeout);
  }, [delayMs, episode, flag]);
  return flag && sustainedEpisode === episode;
}
