import { useEffect, useState, useSyncExternalStore } from "react";

export function useInView<T extends Element>(rootMargin = "0px") {
  const [el, setEl] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.at(-1)?.isIntersecting ?? false;
        setInView(visible);
        if (visible) setSeen(true);
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, rootMargin]);
  return { ref: setEl, inView, seen };
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

export function usePageHidden() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.hidden,
    () => false,
  );
}

export function useActiveWhileVisible<T extends Element>(rootMargin = "0px") {
  const view = useInView<T>(rootMargin);
  const hidden = usePageHidden();
  return { ...view, active: view.inView && !hidden };
}
