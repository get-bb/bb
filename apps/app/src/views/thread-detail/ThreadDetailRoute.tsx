import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import type { ReactNode } from "react";
import {
  createDiffWorker,
  getDiffWorkerPoolSize,
} from "@/lib/diff-worker-pool";
import { SplitThreadArea } from "./SplitThreadArea";
import { ThreadDetailView } from "./ThreadDetailView";
import type { ThreadRoutePathArgs } from "@/lib/route-paths";

const WORKER_POOL_OPTIONS = {
  workerFactory: createDiffWorker,
  poolSize: getDiffWorkerPoolSize(),
};
const HIGHLIGHTER_OPTIONS = {};

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

interface ThreadDetailWorkerPoolProviderProps {
  children: ReactNode;
}

export function ThreadDetailWorkerPoolProvider({
  children,
}: ThreadDetailWorkerPoolProviderProps) {
  return (
    <WorkerPoolContextProvider
      poolOptions={WORKER_POOL_OPTIONS}
      highlighterOptions={HIGHLIGHTER_OPTIONS}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}

export function SingleThreadDetailRoute(props: ThreadDetailRouteProps) {
  return props.surface === "popout" ? (
    <ThreadDetailView
      surface="popout"
      onPopoutHide={props.onPopoutHide}
      onPopoutNewQuickThread={props.onPopoutNewQuickThread}
      onPopoutOpenInMain={props.onPopoutOpenInMain}
    />
  ) : (
    <ThreadDetailView surface="page" />
  );
}

export default function ThreadDetailRoute(props: ThreadDetailRouteProps) {
  // Popout keeps its dedicated single-thread route. The page surface renders
  // the split area, with one shared diff worker pool above all panes.
  return (
    <ThreadDetailWorkerPoolProvider>
      {props.surface === "popout" ? (
        <SingleThreadDetailRoute {...props} />
      ) : (
        <SplitThreadArea />
      )}
    </ThreadDetailWorkerPoolProvider>
  );
}
