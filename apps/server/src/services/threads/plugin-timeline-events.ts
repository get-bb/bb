import { extensionKindSchema, type PluginTimelineEvent } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";

export function insertTimelineEventRows(
  rows: TimelineRow[],
  markers: PluginTimelineEvent[],
): void {
  for (const marker of markers) {
    const row: TimelineRow = {
      id: `plugin-event:${marker.threadId}:${marker.pluginId}:${marker.id}`,
      threadId: marker.threadId,
      turnId: marker.turnId,
      sourceSeqStart: marker.requestSequence,
      sourceSeqEnd: marker.requestSequence,
      startedAt: marker.startedAt,
      createdAt: marker.startedAt,
      kind: "work",
      workKind: "extension",
      experimental_timelineEventId: marker.id,
      status: marker.status,
      callId: marker.id,
      extensionKind: extensionKindSchema.parse(
        `${marker.pluginId}/${marker.rendererId}`,
      ),
      payload: marker.payload,
      completedAt: marker.completedAt,
      presentation: marker.presentation,
    };
    const index = rows.findIndex(
      (candidate) =>
        (marker.turnId !== null && candidate.turnId === marker.turnId) ||
        candidate.sourceSeqStart >= marker.requestSequence,
    );
    rows.splice(index === -1 ? rows.length : index, 0, row);
  }
}
