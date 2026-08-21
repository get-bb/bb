// bb demo server — a mock bb server for App Store review.
//
// WHY THIS EXISTS
//
// A bb server's public API is unauthenticated and permits command execution
// and file reads (see the warning in apps/server/src/start-server.ts). So the
// obvious way to give an App Review reviewer something to connect to — put a
// real bb server on the internet and paste the URL into the review notes —
// publishes a shell. The connect path is authenticated, but its pairing codes
// are single-use and expire in ten minutes (CONNECT_CODE_TTL_MS), which no
// reviewer can work with.
//
// This worker answers the subset of the bb server API that the mobile app
// touches on its launch path, from fixed fixtures. It runs no commands, reads
// no files, and holds no credentials, so it is safe to expose. A reviewer adds
// it as a Direct URL server and sees a working app.
//
// WHAT IT IS NOT
//
// It is not a bb server and must never be presented as one to users. It exists
// for review and for demos. Every route that is not part of the demo path
// answers 501 with a clear message, so an unimplemented corner reads as "not
// available in the demo" rather than as a broken app.
//
// ISOLATION
//
// Each client address gets its own Durable Object, so the messages a reviewer
// sends are visible only to that reviewer. The server is public: a shared
// world would let anyone put text in front of Apple's reviewer, and would
// let one visitor read what another typed. State is in-memory only and is
// dropped when the object goes idle.

import { DemoStateDO } from "./demo-state.js";

export interface Env {
  DEMO_STATE: DurableObjectNamespace;
}

export { DemoStateDO };

/** The Durable Object name for a request: its client address, or one shared fallback when none is known (local dev). */
function demoStateName(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "local";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.DEMO_STATE.idFromName(demoStateName(request));
    return env.DEMO_STATE.get(id).fetch(request);
  },
};
