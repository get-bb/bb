// bb-plugin-scheduled-send backend — one RPC that turns a composer draft into
// a user-owned dispatch hold.
//
// This is deliberately thin. `holdUntil` is a first-class field on the public
// send route, so scheduling is one SDK call; the hold row, the timer that
// releases it, restart survival, and every hold affordance in the UI are core's.
// The plugin exists to put the choice in the composer, not to own the schedule.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { MAX_SCHEDULE_AHEAD_MS } from "./schedule-time.js";

export const scheduledSendRpcContract = defineRpcContract({
  scheduleSend: {
    input: z
      .object({
        threadId: z.string().min(1),
        text: z.string().min(1),
        /** Epoch ms, matching the send route's `holdUntil`. */
        holdUntil: z.number().int().nonnegative(),
      })
      .strict(),
    output: z
      .object({
        /** The send route's delivery outcome; `"held"` when scheduling worked. */
        delivery: z.string(),
        holdUntil: z.number(),
      })
      .strict(),
  },
});

export default async function scheduledSendPlugin(
  bb: BbPluginApi,
): Promise<void> {
  bb.rpc.register(scheduledSendRpcContract, {
    async scheduleSend({ threadId, text, holdUntil }) {
      // The frontend parses the time, but it parsed it a moment ago against a
      // clock the user could have spent minutes ignoring, and the route accepts
      // any non-negative timestamp — a past `holdUntil` releases on the next
      // sweep, which is an instant send the user never asked for.
      const now = Date.now();
      if (holdUntil <= now) {
        throw new Error(
          "That time has already passed. Pick a time in the future.",
        );
      }
      if (holdUntil > now + MAX_SCHEDULE_AHEAD_MS) {
        throw new Error("Pick a time within the next year.");
      }

      const result = await bb.sdk.threads.send({
        threadId,
        // Irrelevant to a held send — a released hold always dispatches as
        // `queue-if-active` — but the route requires a mode, and this is the
        // one the composer itself would have used.
        mode: "auto",
        input: [{ type: "text", text, mentions: [] }],
        holdUntil,
      });

      if (result.delivery !== "held") {
        // A server that accepted the send without holding it means this build
        // predates `holdUntil`; the message is already gone, so say so rather
        // than reporting a schedule that does not exist.
        bb.log.warn(
          `scheduled send for ${threadId} was delivered as "${result.delivery}" instead of "held"`,
        );
      }

      return { delivery: result.delivery, holdUntil };
    },
  });
}
