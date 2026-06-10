import { usePointerCoarse } from "./use-pointer-coarse.js";

/**
 * Browsers do not expose a reliable "will this focus open a virtual keyboard"
 * signal. For passive text autofocus, avoid devices whose primary pointer is
 * coarse; compact viewport is a layout signal and should not disable desktop
 * autofocus by itself.
 */
export function useShouldAvoidSoftKeyboardAutofocus() {
  const isPointerCoarse = usePointerCoarse();

  return isPointerCoarse;
}
