export type CommitOlderTimelineRows = (update: () => void) => Promise<void>;

export type LoadOlderTimelineRows = (
  commit?: CommitOlderTimelineRows,
) => Promise<void> | void;
