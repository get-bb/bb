import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const ASKED_KEY = "asked";
export const PROMPTS_BEFORE_ASKING = 5;

const claimOutcomeSchema = z.enum(["show", "wait", "done"]);
export type ClaimOutcome = z.infer<typeof claimOutcomeSchema>;

export const githubStarRpcContract = defineRpcContract({
  claim: {
    input: z.null(),
    output: z.object({ outcome: claimOutcomeSchema }).strict(),
  },
});

export default function githubStarPlugin(bb: BbPluginApi): void {
  let queue: Promise<unknown> = Promise.resolve();

  async function claim(): Promise<ClaimOutcome> {
    if ((await bb.storage.kv.get<unknown>(ASKED_KEY)) === true) return "done";
    const { entries } = await bb.sdk.experimental_promptHistory.list({
      limit: String(PROMPTS_BEFORE_ASKING + 1),
    });
    if (entries.length <= PROMPTS_BEFORE_ASKING) return "wait";
    await bb.storage.kv.set(ASKED_KEY, true);
    return "show";
  }

  bb.rpc.register(githubStarRpcContract, {
    async claim() {
      const next = queue.then(claim);
      queue = next.catch(() => undefined);
      return { outcome: await next };
    },
  });
}
