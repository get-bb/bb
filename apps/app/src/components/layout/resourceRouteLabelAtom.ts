import { atom } from "jotai";

/** Loaded resource label shared by the app shell and focused split-pane header. */
export const resourceRouteLabelAtom = atom<string | null>(null);
