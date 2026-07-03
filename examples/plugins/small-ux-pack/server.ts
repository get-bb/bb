// bb-plugin-small-ux-pack — the "Small UX pack" hero plugin (design §8).
//
// A dependency-free plugin whose entire surface is host-rendered UI: no
// frontend bundle, no build step, no node_modules. The shipped app renders
// everything from GET /api/v1/plugins/contributions:
// - bb.ui.registerThreadAction "Summarize thread": confirm dialog, then a
//   follow-up prompt sent through bb.sdk.threads.send, then a success toast.
// - bb.ui.registerThreadAction "Copy status": deliberately throws (the
//   server cannot reach your clipboard) to demonstrate the automatic
//   error-toast path.
// The type-only import below is erased at load time, so this file runs
// as-is.
import type { BbPluginApi } from "@bb/plugin-sdk";

const SUMMARIZE_PROMPT =
  "Summarize this thread so far in three short bullet points: what was asked, " +
  "what has been done, and what is still open.";

export default function plugin(bb: BbPluginApi) {
  bb.ui.registerThreadAction({
    id: "summarize-thread",
    title: "Summarize thread",
    icon: "ListChecks",
    confirm: "Ask this thread's agent for a three-bullet summary?",
    async run({ threadId }) {
      await bb.sdk.threads.send({
        threadId,
        mode: "auto",
        input: [{ type: "text", text: SUMMARIZE_PROMPT, mentions: [] }],
      });
      return {
        toast: {
          kind: "success",
          message: "Summary requested — watch for the agent's reply.",
        },
      };
    },
  });

  bb.ui.registerThreadAction({
    id: "copy-status",
    title: "Copy status",
    icon: "Clipboard",
    async run({ threadId }) {
      const thread = await bb.sdk.threads.get({ threadId });
      // Thread actions run server-side, so there is no clipboard to copy
      // to. Throwing here is the point: the host turns any rejection into
      // an error toast at the click site (design §4.9).
      throw new Error(
        `the server cannot reach your clipboard — thread status is "${thread.status}". ` +
          "(This action exists to demonstrate the automatic error toast.)",
      );
    },
  });

}
