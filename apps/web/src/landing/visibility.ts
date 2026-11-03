import { useEffect, useState, useSyncExternalStore } from "react";

export function useInView<T extends Element>() {
  const [el, setEl] = useState<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setSeen(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return { ref: setEl, seen };
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

export function usePageHidden() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "hidden",
    () => false,
  );
}

export function useActiveWhileVisible<T extends Element>(rootMargin = "0px") {
  const view = useInView<T>(rootMargin);
  const hidden = usePageHidden();
  return { ...view, active: view.inView && !hidden };
}
