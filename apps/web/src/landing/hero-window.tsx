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

import {
  useExperiment,
  useExperimentExposure,
} from "../experiments/use-experiment";
import { WindowControls, useFitMock } from "./app-mock-parts";
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
  const arm = useExperiment("homepage-hero-window");
  const { ref, seen, active } =
    useActiveWhileVisible<HTMLElement>("0px 0px -20% 0px");
  useExperimentExposure("homepage-hero-window", "desktop", seen);
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
      className={paused ? "mockup-wrap rhb is-paused" : "mockup-wrap rhb"}
    >
      <div
        ref={winRef}
        className="mock rhb-win"
        role="img"
        aria-label="Animated preview of one bb session customizing itself from prompts, one plugin or script at a time: a Sentry errors page the agent writes and opens beside the thread, team invites, where a Codex child thread builds the invite API and emails while the main thread builds the invite screen, and the two threads message each other, a Linear issues panel the agent writes, a Generative UI chart and Impromptu UI fix cards that start child threads, Linear issue mentions opened with # in the composer, New thread and Search moved into the left rail, and a sidebar grouped by status, ending on the fully customized app"
      >
        <div className="rhb-band rhb-band-left" aria-hidden>
          <WindowControls />
        </div>
        {stage}
      </div>
    </section>
  );
}
