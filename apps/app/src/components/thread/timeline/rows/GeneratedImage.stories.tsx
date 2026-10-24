import { useState } from "react";
import { ThreadTimelineRows } from "@/components/thread/timeline";
import {
  GENERATED_IMAGE_SRC,
  GENERATED_IMAGE_THREAD_ID,
  generatedImageTimeline,
} from "@/test/fixtures/generated-image-turn";

export default { title: "thread/timeline/Generated image" };

export function Completion() {
  const [completed, setCompleted] = useState(true);
  const [mount, setMount] = useState(0);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <div className="flex flex-wrap gap-3 text-sm">
        <button onClick={() => setCompleted(false)}>Start fixture</button>
        <button onClick={() => setCompleted(true)}>Complete turn</button>
        <button onClick={() => setMount((value) => value + 1)}>
          Reload timeline
        </button>
      </div>
      <ThreadTimelineRows
        key={mount}
        threadId={GENERATED_IMAGE_THREAD_ID}
        timelineRows={generatedImageTimeline(completed)}
        threadRuntimeDisplayStatus={completed ? "idle" : "active"}
        workspaceRootPath="/workspace"
        resolveImageViewSrc={() => GENERATED_IMAGE_SRC}
      />
    </div>
  );
}
