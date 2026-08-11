import { useCallback, useEffect, useState } from "react";

// vaul keeps a closing drawer mounted for its ~500ms exit transition and
// tears it down afterwards. The grace must outlast that teardown so the
// panel never unmounts mid-slide, and so a quick reopen finds the panel
// still mounted and skips the mount cost entirely.
const DRAWER_PANEL_TEARDOWN_GRACE_MS = 700;
// Realization normally happens when the entrance animation ends. The
// fallback covers environments where that event never fires (reduced
// motion, jsdom).
const DRAWER_PANEL_REALIZE_FALLBACK_MS = 700;

/**
 * Defers the mount of a bottom drawer's heavy panel until the sheet's
 * entrance animation has finished. vaul mounts drawer children synchronously
 * inside the opening tap; on an iPhone the secondary panel's mount plus its
 * style resolution cost ~430 ms of main-thread time, which froze the
 * slide-in (see the iOS drawer performance recording behind this change).
 * A light skeleton rides the entrance instead, and the real panel mounts one
 * settle callback later, while the sheet is at rest.
 *
 * The caller invokes `realizePanel` from its drawer settle callback and
 * swaps `isPanelRealized ? panel : skeleton` in the drawer body.
 */
export function useDrawerPanelRealization({
  isDrawerOpen,
  rendersAsDrawer,
}: {
  isDrawerOpen: boolean;
  rendersAsDrawer: boolean;
}): { isPanelRealized: boolean; realizePanel: () => void } {
  const [isPanelRealized, setIsPanelRealized] = useState(false);
  const realizePanel = useCallback(() => setIsPanelRealized(true), []);

  useEffect(() => {
    if (!rendersAsDrawer) {
      return;
    }
    if (isDrawerOpen) {
      const timeout = window.setTimeout(
        () => setIsPanelRealized(true),
        DRAWER_PANEL_REALIZE_FALLBACK_MS,
      );
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(
      () => setIsPanelRealized(false),
      DRAWER_PANEL_TEARDOWN_GRACE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [isDrawerOpen, rendersAsDrawer]);

  // A wide viewport renders the panel inline; the drawer flag only has
  // meaning while the drawer branch renders.
  return { isPanelRealized: rendersAsDrawer && isPanelRealized, realizePanel };
}
