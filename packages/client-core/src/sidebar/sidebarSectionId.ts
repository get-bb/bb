// Identity of a top-level sidebar section. Built-in sections are "pinned" and
// "threads"; entity sections are keyed by kind and id.
export type SidebarSectionId =
  | "pinned"
  | "threads"
  | `project:${string}`
  | `section:${string}`
  | `machine:${string}`;
export type CollapsibleSidebarSectionId = "pinned" | "threads";
