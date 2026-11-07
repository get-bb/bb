import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode, Ref } from "react";

import { useExperiment } from "../experiments/use-experiment";
import {
  ChevronLeft,
  ChevronRight,
  PanelIcon,
  WindowDots,
  useFitMock,
} from "./app-mock-parts";
import { useActiveWhileVisible } from "./visibility";

const HeroWindowStage = lazy(() => import("./hero-window-stage"));

function OnMount({ onMount }: { onMount: () => void }) {
  useEffect(onMount, [onMount]);
  return null;
}

export function HeroWindowSlot({
  control,
}: {
  control: (ref: Ref<HTMLElement>) => ReactNode;
}) {
  const arm = useExperiment("homepage-hero");
  const { ref, active } =
    useActiveWhileVisible<HTMLElement>("0px 0px -20% 0px");
  return arm === "test" ? (
    <HeroWindow ref={ref} active={active} />
  ) : (
    control(ref)
  );
}

export function HeroWindow({
  ref,
  active,
}: {
  ref: Ref<HTMLElement>;
  active: boolean;
}) {
  const [live, setLive] = useState(false);
  const paused = !active || !live;
  const winRef = useRef<HTMLDivElement>(null);
  useFitMock(winRef);
  const markLive = useCallback(() => setLive(true), []);
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
      className={
        paused ? "mockup-wrap mock-ui rhb is-paused" : "mockup-wrap mock-ui rhb"
      }
    >
      <div
        ref={winRef}
        className="mock rhb-win"
        role="img"
        aria-label="Animated preview of one bb session customizing itself from prompts, one plugin or script at a time: a Sentry errors page the agent writes and opens beside the thread, team invites, where a Codex child thread builds the invite API and emails while the main thread builds the invite screen, and the two threads message each other, a Linear issues panel the agent writes, a Generative UI chart and Impromptu UI fix cards that start child threads, a custom GitHub issue picker opened with # in the composer, navigation icons moved into the sidebar, and a sidebar grouped by status, ending on the fully customized app"
      >
        <div className="rhb-band rhb-band-left" aria-hidden>
          <WindowDots />
          <span className="rhb-band-ctrls">
            <PanelIcon className="rhb-ic" />
            <span className="rhb-band-gap" />
            <ChevronLeft className="rhb-ic" />
            <ChevronRight className="rhb-ic" />
          </span>
        </div>
        {stage}
      </div>
    </section>
  );
}
