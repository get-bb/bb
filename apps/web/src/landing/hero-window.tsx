import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Ref } from "react";

import { WindowControls, useFitMock } from "./app-mock-parts";

const HeroWindowStage = lazy(() => import("./hero-window-stage"));

function OnMount({ onMount }: { onMount: () => void }) {
  useEffect(onMount, [onMount]);
  return null;
}

export function HeroWindow({
  ref,
  active,
  onFilled,
}: {
  ref: Ref<HTMLElement>;
  active: boolean;
  onFilled: () => void;
}) {
  const [live, setLive] = useState(false);
  const paused = !active || !live;
  const winRef = useRef<HTMLDivElement>(null);
  useFitMock(winRef);
  useLayoutEffect(() => {
    if (winRef.current?.querySelector(".rhb-stage")) onFilled();
  }, [onFilled]);
  const markLive = useCallback(() => {
    setLive(true);
    onFilled();
  }, [onFilled]);
  const stage = useMemo(
    () => (
      <Suspense>
        <OnMount onMount={markLive} />
        <HeroWindowStage paused={paused} />
      </Suspense>
    ),
    [markLive, paused],
  );
  return (
    <section
      ref={ref}
      className={paused ? "mockup-wrap rhb is-paused" : "mockup-wrap rhb"}
    >
      <div
        ref={winRef}
        className="mock rhb-win"
        role="img"
        aria-label="Animated preview of one bb session customizing itself from prompts, one plugin or script at a time: a Sentry errors page the agent writes and opens beside the thread, a Codex child thread started to write tests for a CSV export and the two threads messaging each other, a Linear issues panel the agent writes, a Generative UI chart and Impromptu UI fix cards that start child threads, a custom GitHub issue picker opened with # in the composer, navigation icons moved into the sidebar, and a sidebar grouped by status, ending on the fully customized app"
      >
        <div className="rhb-band rhb-band-left" aria-hidden>
          <WindowControls />
        </div>
        {stage}
      </div>
    </section>
  );
}
