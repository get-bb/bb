import { createThreadArchiveFilterAtom } from "@/lib/thread-lifecycle-filter";

export const paletteThreadLifecyclesAtom = createThreadArchiveFilterAtom(
  "bb.palette.threadArchiveFilter",
);
