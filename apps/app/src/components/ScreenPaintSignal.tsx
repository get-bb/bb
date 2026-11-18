import { useEffect } from "react";
import { markScreenPainted } from "@/lib/screen-paint";
import {
  startSplitPreloading,
  whenCriticalLoadsSettled,
} from "@/lib/split-prefetch";

export function ScreenPaintSignal() {
  useEffect(() => {
    void whenCriticalLoadsSettled().then(markScreenPainted);
    startSplitPreloading();
  }, []);
  return null;
}
