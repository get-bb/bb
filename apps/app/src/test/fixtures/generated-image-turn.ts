import { turnScope, type CompletedTurnDisplay } from "@bb/domain";
import {
  buildThreadTimelineFromEvents,
  type ThreadEventWithMeta,
} from "@bb/thread-view";

export const GENERATED_IMAGE_THREAD_ID = "thr_generated_image";
export const GENERATED_IMAGE_SRC =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="white"/><circle cx="256" cy="256" r="160" fill="#3582e5"/></svg>',
  );

export function generatedImageEvents(completed: boolean): ThreadEventWithMeta[] {
  const common = {
    threadId: GENERATED_IMAGE_THREAD_ID,
    providerThreadId: "provider-image",
    scope: turnScope("turn-image"),
  };
  const image = {
    type: "imageGeneration" as const,
    id: "generated-image",
    status: "pending" as const,
    prompt: "Draw a blue circle",
    path: "/workspace/generated.svg",
    error: null,
    transparentBackground: false,
    presentation: {
      label: { pending: "Generating image", completed: "Generated image" },
      icon: { glyph: "Palette" as const },
      title: "generated.svg",
    },
  };
  const events: ThreadEventWithMeta["event"][] = [
    { ...common, type: "turn/started" },
    {
      ...common,
      type: "item/completed",
      item: {
        type: "commandExecution",
        id: "ordinary-command",
        command: "pwd",
        cwd: "/workspace",
        status: "completed",
        approvalStatus: null,
        aggregatedOutput: "ORDINARY COMMAND OUTPUT",
      },
    },
    { ...common, type: "item/started", item: image },
  ];
  if (completed) {
    events.push(
      {
        ...common,
        type: "item/completed",
        item: { ...image, status: "completed" },
      },
      {
        ...common,
        type: "item/completed",
        item: {
          type: "agentMessage",
          id: "image-answer",
          text: "Here is your blue circle.",
        },
      },
      { ...common, type: "turn/completed", status: "completed" },
    );
  }
  return events.map((event, index) => ({
    event,
    meta: {
      id: `image-event-${index}`,
      seq: index + 1,
      createdAt: 1_780_410_615_000 + index * 1_000,
    },
  }));
}

export function generatedImageTimeline(
  completed: boolean,
  completedTurnDisplay: CompletedTurnDisplay = "collapse",
) {
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: {
      acceptedClientRequestEvents: [],
      rejectedClientRequestEvents: [],
    },
    contextWindowEvents: [],
    events: generatedImageEvents(completed),
    options: {
      completedTurnDisplay,
      includeNestedRows: false,
      includeDiagnosticOperations: false,
      summarizeShellCommands: true,
      isLatestPage: true,
      threadStatus: completed ? "idle" : "active",
      threadName: "A blue circle",
      workspaceRoot: "/workspace",
    },
  }).rows;
}
