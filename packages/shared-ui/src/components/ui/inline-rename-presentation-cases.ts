export type RenamePresentationOutcome = "inline" | "dialog" | "none";

export interface RenamePresentationCase {
  compact: boolean;
  coarse: boolean;
  menu: RenamePresentationOutcome;
  direct: RenamePresentationOutcome;
  doubleClick: RenamePresentationOutcome;
}

export const RENAME_PRESENTATION_CASES: readonly RenamePresentationCase[] = [
  {
    compact: false,
    coarse: false,
    menu: "inline",
    direct: "inline",
    doubleClick: "inline",
  },
  {
    compact: true,
    coarse: false,
    menu: "dialog",
    direct: "dialog",
    doubleClick: "inline",
  },
  {
    compact: false,
    coarse: true,
    menu: "dialog",
    direct: "dialog",
    doubleClick: "none",
  },
  {
    compact: true,
    coarse: true,
    menu: "dialog",
    direct: "dialog",
    doubleClick: "none",
  },
];
