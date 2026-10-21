import type { ComponentProps } from "react";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { defineSplit } from "@/lib/define-split";
import type { RemotePathBrowser } from "./RemotePathBrowser";

export const LazyRemotePathBrowser = defineSplit<
  ComponentProps<typeof RemotePathBrowser>
>({
  id: "remote-path-browser",
  load: () =>
    import("./RemotePathBrowser").then((module) => module.RemotePathBrowser),
  loading: () => (
    <EmptyState
      icon="Spinner"
      iconClassName="animate-spin"
      message="Loading folders…"
      className="px-2 py-3"
    />
  ),
  tier: "preload",
});
