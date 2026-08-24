// @bb/client-core: DOM-free, React-free client logic shared by the web app
// (`apps/app`) and the native app (`apps/mobile`). Nothing here may touch
// `window`, `document`, `localStorage`, `navigator`, or react-router; see
// `test/no-dom.test.ts`.

// Cross-surface request types.
export * from "./api-types.js";

// Thread state.
export * from "./thread/thread-read-state.js";
export * from "./thread/thread-activity.js";

// Sidebar grouping, sorting, and ordering.
export * from "./codepoint-compare.js";
export * from "./sidebar/sectionKeys.js";
export * from "./sidebar/projectThreadGroups.js";
export * from "./sidebar/machineThreadGroups.js";
export * from "./sidebar/pinnedSidebarThreads.js";
export * from "./sidebar/threadReadState.js";
export * from "./sidebar/sidebarSectionId.js";
export * from "./sidebar/sidebarSectionOrder.js";
export * from "./sidebar/neighbor-reorder.js";

// Composer: drafts, submission policy, mentions, fork/handoff seeds.
export * from "./prompt/create-resource-prompts.js";
export * from "./prompt/automation-prompt.js";
export * from "./prompt/prompt-draft.js";
export * from "./prompt/follow-up-submit-mode.js";
export * from "./prompt/threadDetailPromptSubmission.js";
export * from "./prompt/threadQueuedMessages.js";
export * from "./prompt/effective-prompt-mode.js";
export * from "./prompt/permission-mode-options.js";
export * from "./prompt/mentions/plugin-mention-triggers.js";
export * from "./prompt/mentions/types.js";
export * from "./prompt/mentions/find-active-trigger.js";
export * from "./prompt/mentions/command-trigger.js";
export * from "./prompt/fork-thread-request.js";
export * from "./prompt/thread-handoff-request.js";

// Timeline: row policy and the loaded-window merge.
export * from "./timeline/thread-runtime-status.js";
export * from "./timeline/timeline-auto-expand.js";
export * from "./timeline/timelineRowSignatures.js";
export * from "./timeline/conversation-message-limits.js";
export * from "./timeline/compute-muted-prefix-length.js";
export * from "./timeline/conversation-turn-request-label.js";
export * from "./timeline/optimistic-timeline-row.js";
export * from "./timeline/timeline-merge.js";

// Diff patch normalization (parser-agnostic).
export * from "./diff/renderable-patch.js";

// Terminal attach transport.
export * from "./terminal/terminal-websocket-transport.js";
export * from "./terminal/terminal-websocket-path.js";

// Secondary panel tab state.
export * from "./file-preview.js";
export * from "./panel/fixed-panel-tabs-state.js";
export * from "./panel/secondaryPanelTabState.js";
export * from "./panel/array-move.js";

// Links and routes.
export * from "./localhost-link-rewrite.js";
export * from "./routes/route-paths.js";
