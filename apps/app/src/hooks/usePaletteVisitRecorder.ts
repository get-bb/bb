import { useEffect } from "react";
import { recordPaletteVisit } from "@/lib/command-palette/palette-visits";

export function usePaletteVisitRecorder(threadId: string | null): void {
  useEffect(() => {
    if (threadId === null) return;
    recordPaletteVisit("thread", threadId);
  }, [threadId]);
}
