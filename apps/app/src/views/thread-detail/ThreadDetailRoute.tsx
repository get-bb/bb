import DiffWorkerPoolProvider from "@/components/secondary-panel/DiffWorkerPoolProvider";
import { ThreadDetailView } from "./ThreadDetailView";
import type { ThreadRoutePathArgs } from "@/lib/route-paths";

interface ThreadDetailRoutePageProps {
  surface?: "page";
}

interface ThreadDetailRoutePopoutProps {
  onPopoutHide: () => void;
  onPopoutNewQuickThread: () => void;
  onPopoutOpenInMain: (thread: ThreadRoutePathArgs) => void;
  surface: "popout";
}

type ThreadDetailRouteProps =
  | ThreadDetailRoutePageProps
  | ThreadDetailRoutePopoutProps;

export default function ThreadDetailRoute(props: ThreadDetailRouteProps) {
  const view =
    props.surface === "popout" ? (
      <ThreadDetailView
        surface="popout"
        onPopoutHide={props.onPopoutHide}
        onPopoutNewQuickThread={props.onPopoutNewQuickThread}
        onPopoutOpenInMain={props.onPopoutOpenInMain}
      />
    ) : (
      <ThreadDetailView surface="page" />
    );

  return <DiffWorkerPoolProvider>{view}</DiffWorkerPoolProvider>;
}
