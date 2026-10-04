import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";
import { createThreadArchiveFilterAtom } from "@/lib/thread-lifecycle-filter";

export const paletteThreadLifecyclesAtom = createThreadArchiveFilterAtom(
  "bb.palette.threadArchiveFilter",
);

export type PaletteKindFilter = "all" | "threads";

function isPaletteKindFilter(value: unknown): value is PaletteKindFilter {
  return value === "all" || value === "threads";
}

export const paletteKindFilterAtom = atomWithStorage<PaletteKindFilter>(
  "bb.palette.kindFilter",
  "all",
  createJsonLocalStorage(isPaletteKindFilter),
  { getOnInit: true },
);
