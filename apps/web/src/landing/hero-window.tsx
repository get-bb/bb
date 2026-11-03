import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Ref } from "react";

const HeroWindowStage = lazy(() => import("./hero-window-stage"));

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function usePageHidden() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "hidden",
    () => false,
  );
}

function OnMount({ onMount }: { onMount: () => void }) {
  useEffect(onMount, [onMount]);
  return null;
}

export function HeroWindow({
  ref,
  inView,
  onFilled,
}: {
  ref: Ref<HTMLElement>;
  inView: boolean;
  onFilled: () => void;
}) {
  const hidden = usePageHidden();
  const [live, setLive] = useState(false);
  const paused = !inView || hidden || !live;
  const winRef = useRef<HTMLDivElement>(null);
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
          <span className="mock-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="rhb-band-ctrls">
            <HugeiconsIcon icon={ArrowLeft01Icon} className="rhb-ic" />
            <HugeiconsIcon icon={ArrowRight01Icon} className="rhb-ic" />
            <HugeiconsIcon icon={SidebarLeftIcon} className="rhb-ic" />
          </span>
        </div>
        {stage}
      </div>
    </section>
  );
}
