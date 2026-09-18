import { useEffect } from "react";
import { atom, useStore } from "jotai";
import { useLocation } from "react-router-dom";

const revealedNavigationAtom = atom<string | null>(null);

export function useSidebarNavigationReveal(
  ready: boolean,
  reveal: () => void,
): void {
  const { key } = useLocation();
  const store = useStore();

  useEffect(() => {
    if (!ready || store.get(revealedNavigationAtom) === key) {
      return;
    }
    store.set(revealedNavigationAtom, key);
    reveal();
  }, [key, ready, reveal, store]);
}
