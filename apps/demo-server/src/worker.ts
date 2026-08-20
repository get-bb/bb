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
// All state lives in one Durable Object so a sent message and the WebSocket
// that announces it share a consistent view.

import { DemoStateDO } from "./demo-state.js";

export interface Env {
  DEMO_STATE: DurableObjectNamespace;
}

export { DemoStateDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // A single global instance: the demo is one shared world, and Workers give
    // no cheaper way to keep the socket and the timeline in step.
    const id = env.DEMO_STATE.idFromName("demo");
    return env.DEMO_STATE.get(id).fetch(request);
  },
};
