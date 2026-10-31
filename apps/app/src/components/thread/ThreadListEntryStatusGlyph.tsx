import type { ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { ThreadStatusGlyph } from "@/components/thread/ThreadStatusGlyph";
import { useThreadListEntryStatus } from "@/hooks/useThreadListEntryStatus";

export function ThreadListEntryStatusGlyph({
  thread,
  idle,
}: {
  thread: ThreadListEntry;
  idle: ReactNode;
}) {
  const { indicator, rowStatus } = useThreadListEntryStatus(thread);
  if (indicator === "none" && rowStatus === null) return idle;
  return (
    <ThreadStatusGlyph
      indicator={indicator}
      rowStatus={rowStatus}
      size="compact"
    />
  );
}
