import { useEffect, useState } from "react";

export function useInView<T extends Element>(rootMargin = "0px") {
  const [el, setEl] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry?.isIntersecting ?? false;
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
