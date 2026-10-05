import { useEffect } from "react";
import { recordPaletteThreadVisit } from "@/lib/command-palette/palette-visits";

export function usePaletteVisitRecorder(threadId: string | null): void {
  useEffect(() => {
    if (threadId === null) return;
    recordPaletteThreadVisit(threadId);
  }, [threadId]);
}
