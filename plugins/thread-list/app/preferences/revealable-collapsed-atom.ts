import { atom, type SetStateAction, type WritableAtom } from "jotai";

type CollapsedListAtom<Id extends string> = WritableAtom<
  Id[],
  [SetStateAction<Id[]>],
  void
>;

export interface RevealableCollapsedAtoms<Id extends string> {
  collapsed: CollapsedListAtom<Id>;
  reveal: WritableAtom<null, [ReadonlySet<string>], void>;
}

function withoutRevealed<Id extends string>(
  stored: Id[],
  revealed: readonly Id[],
): Id[] {
  if (revealed.length === 0) return stored;
  const visible = stored.filter((id) => !revealed.includes(id));
  return visible.length === stored.length ? stored : visible;
}

export function createRevealableCollapsedAtoms<Id extends string>(
  stored: CollapsedListAtom<Id>,
): RevealableCollapsedAtoms<Id> {
  const revealed = atom<readonly Id[]>([]);
  const collapsed: CollapsedListAtom<Id> = atom(
    (get) => withoutRevealed(get(stored), get(revealed)),
    (get, set, update: SetStateAction<Id[]>) => {
      const previous = get(collapsed);
      const next = typeof update === "function" ? update(previous) : update;
      if (Object.is(next, previous)) return;
      const storedIds = get(stored);
      const stillRevealed = get(revealed).filter(
        (id) => storedIds.includes(id) && !next.includes(id),
      );
      set(revealed, stillRevealed);
      set(
        stored,
        stillRevealed.length === 0 ? next : [...next, ...stillRevealed],
      );
    },
  );
  const reveal = atom(null, (get, set, ids: ReadonlySet<string>) => {
    const current = get(revealed);
    const added = get(stored).filter(
      (id) => ids.has(id) && !current.includes(id),
    );
    if (added.length > 0) set(revealed, [...current, ...added]);
  });
  return { collapsed, reveal };
}
