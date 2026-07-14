import { ThreadDetailView } from "./ThreadDetailView";
import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import { ThreadDetailWorkerPoolProvider } from "./ThreadDetailWorkerPoolProvider";

interface ThreadDetailRouteProps {
  onPopoutHide: () => void;
  onPopoutNewQuickThread: () => void;
  onPopoutOpenInMain: (thread: ThreadRoutePathArgs) => void;
  surface: "popout";
}

export function SingleThreadDetailRoute(props: ThreadDetailRouteProps) {
  return (
    <ThreadDetailView
      surface="popout"
      onPopoutHide={props.onPopoutHide}
      onPopoutNewQuickThread={props.onPopoutNewQuickThread}
      onPopoutOpenInMain={props.onPopoutOpenInMain}
    />
  );
}

export default function ThreadDetailRoute(props: ThreadDetailRouteProps) {
  // Popout keeps its dedicated single-thread route. Page thread routes are
  // owned by SplitWorkspaceRoute so focus changes never remount that workspace.
  return (
    <ThreadDetailWorkerPoolProvider>
      <SingleThreadDetailRoute {...props} />
    </ThreadDetailWorkerPoolProvider>
  );
}
