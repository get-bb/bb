// bb-plugin-thread-chat-demo — the backend entry.
//
// This demo is frontend-only (its whole surface lives in app.tsx: a nav
// panel and a messageAction rendering the SDK ThreadChat component), but
// every plugin manifest requires a server entry. The type-only import is
// erased at load time, so this file runs as-is.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function plugin(bb: BbPluginApi) {
  bb.log.info("thread-chat-demo loaded (frontend-only demo)");
}
