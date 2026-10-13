import { useEffect, useSyncExternalStore } from "react";
import { defineSplit } from "@/lib/define-split";
import { queueSplitPreload } from "@/lib/split-prefetch";
import {
  isToasterRequested,
  markToasterUnavailable,
  requestToaster,
  subscribeToasterRequest,
} from "./ui/app-toast-runtime";

function ToasterUnavailable() {
  useEffect(() => markToasterUnavailable(), []);
  return null;
}

const AppToasterSplit = defineSplit({
  id: "app-toaster",
  load: () =>
    import("./AppToasterView").then((module) => module.AppToasterView),
  loading: () => null,
  error: ToasterUnavailable,
  tier: "intent",
});

queueSplitPreload(async () => requestToaster());

export function AppToaster() {
  const requested = useSyncExternalStore(
    subscribeToasterRequest,
    isToasterRequested,
  );
  return requested ? <AppToasterSplit /> : null;
}
