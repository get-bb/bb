import { useEffect, useRef, useState } from "react";
import { useIsSidebarFramed } from "./sidebar.js";
import {
  OverflowFade,
  type OverflowFadeTone,
} from "@bb/shared-ui/overflow-fade";

export function TitleBarScrollFade({ tone }: { tone: OverflowFadeTone }) {
  const isFramed = useIsSidebarFramed();
  const fadeRef = useRef<HTMLDivElement>(null);
  const [isScrolledUnder, setIsScrolledUnder] = useState(false);

  useEffect(() => {
    const host = fadeRef.current?.parentElement;
    if (!host) return;
    const handleScroll = (event: Event) => {
      const scroller = event.target;
      if (!(scroller instanceof HTMLElement)) return;
      const hostTop = host.getBoundingClientRect().top;
      if (Math.abs(scroller.getBoundingClientRect().top - hostTop) > 1) return;
      setIsScrolledUnder(scroller.scrollTop > 0);
    };
    host.addEventListener("scroll", handleScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      host.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, [isFramed]);

  if (!isFramed) return null;
  return (
    <div
      ref={fadeRef}
      aria-hidden
      data-testid="title-bar-scroll-fade"
      data-visible={isScrolledUnder ? "" : undefined}
      className="pointer-events-none absolute inset-x-0 top-0 z-20 h-6 opacity-0 transition-opacity duration-150 data-[visible]:opacity-100"
    >
      <OverflowFade placement="above" inset tone={tone} />
    </div>
  );
}
