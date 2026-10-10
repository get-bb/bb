import { atomWithStorage } from "jotai/utils";
import { z } from "zod";
import { createLocalStorageSyncStorage } from "@/lib/browser-storage";

const collapsedThreadIdsSchema = z.array(z.string().min(1)).max(10_000);

export const mobileRecentsCollapsedThreadIdsAtom = atomWithStorage<string[]>(
  "bb.mobileRecents.collapsedThreads",
  [],
  createLocalStorageSyncStorage<string[]>({
    parse: (storedValue, initialValue) => {
      if (storedValue === null) return initialValue;
      try {
        const parsed = collapsedThreadIdsSchema.safeParse(
          JSON.parse(storedValue),
        );
        return parsed.success ? parsed.data : initialValue;
      } catch {
        return initialValue;
      }
    },
    serialize: JSON.stringify,
  }),
  { getOnInit: true },
);
