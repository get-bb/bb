import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "./browser-storage";

export type MessageActionRole = "user" | "assistant";

const RECENT_LIMIT = 64;
const storage = createJsonLocalStorage<string[]>(
  (value): value is string[] =>
    Array.isArray(value) &&
    value.length <= RECENT_LIMIT &&
    value.every((entry) => typeof entry === "string"),
);
const recentsByRole = {
  user: atomWithStorage<string[]>("bb.messageActionRecents.user", [], storage, {
    getOnInit: true,
  }),
  assistant: atomWithStorage<string[]>(
    "bb.messageActionRecents.assistant",
    [],
    storage,
    { getOnInit: true },
  ),
};

export function useMessageActionRecents(role: MessageActionRole) {
  const [recents, setRecents] = useAtom(recentsByRole[role]);
  return {
    recents,
    recordAction: (id: string) => {
      setRecents((previous) =>
        [id, ...previous.filter((entry) => entry !== id)].slice(
          0,
          RECENT_LIMIT,
        ),
      );
    },
  };
}
