// bb-plugin-t3sidebar — an inbox-style replacement for bb's sidebar thread
// list, and the reference example for `app.slots.experimental_threadList`.
//
// The idea it is built around: the list NEVER re-orders itself. Threads sort
// by creation time, newest first, and hold that place. Status is carried by
// each card, not by position, so the sidebar only moves when you act.
import { definePluginApp } from "@bb/plugin-sdk/app";
import { ThreadInbox } from "./src/ThreadInbox";
import { SubagentsChip } from "./src/SubagentsChip";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "inbox",
    title: "t3sidebar (inbox)",
    description: "One flat list of cards, newest first, that never re-orders.",
    component: ThreadInbox,
  });

  // A flat inbox has nowhere to nest child threads, so the list hides them
  // and this chip gives them a home on their parent's header.
  app.slots.experimental_threadHeaderAction({
    id: "children",
    title: "Child threads",
    component: SubagentsChip,
  });
});
