import type { BbPluginApi } from "@get-bb/plugin-sdk";

const INSTRUCTIONS =
  "Messages from other agents begin with `[bb message from thread:<thread id>]`. Answer the agent with `bb thread tell <thread id>` and the user in your normal response, or do both. You may answer a thread that messaged you even if the user did not ask, but message other threads only when the user asks. Answer questions and requests, and never send acknowledgements or thanks. Other agents do the same, so do not wait for a reply to a message that asks for nothing. The user sees every message you send and receive in the timeline, so do not announce, summarize, or restate them.";

export default function plugin(bb: BbPluginApi) {
  bb.agents.contributeInstructions(() => INSTRUCTIONS);
}
