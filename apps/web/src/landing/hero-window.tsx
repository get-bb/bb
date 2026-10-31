import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useSyncExternalStore } from "react";
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

export function HeroWindow({
  ref,
  inView,
}: {
  ref: Ref<HTMLElement>;
  inView: boolean;
}) {
  const hidden = usePageHidden();
  const paused = !inView || hidden;
  return (
    <section
      ref={ref}
      className={paused ? "mockup-wrap rhb is-paused" : "mockup-wrap rhb"}
    >
      <div
        className="mock rhb-win"
        role="img"
        aria-label="Animated preview of one bb session: the agent adds CSV export to a reports page and starts a Codex child thread to write the tests, the two threads message each other until the tests pass, then the agent writes a Linear issues panel plugin that opens beside the thread with your open issues"
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
        <ClientOnly>
          <Suspense>
            <HeroWindowStage paused={paused} />
          </Suspense>
        </ClientOnly>
      </div>
    </section>
  );
}
