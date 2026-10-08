import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";
import { createThreadArchiveFilterAtom } from "@/lib/thread-lifecycle-filter";

export const paletteThreadLifecyclesAtom = createThreadArchiveFilterAtom(
  "bb.palette.threadArchiveFilter",
);

export const PALETTE_THREAD_SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "updated", label: "Updated at" },
  { value: "created", label: "Created at" },
] as const;

export type PaletteThreadSort =
  (typeof PALETTE_THREAD_SORT_OPTIONS)[number]["value"];

function isPaletteThreadSort(value: unknown): value is PaletteThreadSort {
  return PALETTE_THREAD_SORT_OPTIONS.some((option) => option.value === value);
}

export const paletteThreadSortAtom = atomWithStorage<PaletteThreadSort>(
  "bb.palette.threadSort",
  "relevance",
  createJsonLocalStorage(isPaletteThreadSort),
  { getOnInit: true },
);

export type PaletteThreadSortDirection = "ascending" | "descending";

function isPaletteThreadSortDirection(
  value: unknown,
): value is PaletteThreadSortDirection {
  return value === "ascending" || value === "descending";
}

export const paletteThreadSortDirectionAtom =
  atomWithStorage<PaletteThreadSortDirection>(
    "bb.palette.threadSortDirection",
    "descending",
    createJsonLocalStorage(isPaletteThreadSortDirection),
    { getOnInit: true },
  );
