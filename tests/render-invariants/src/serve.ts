import { z } from "zod";
import { startRenderFixture } from "./fixture.js";

const DEFAULT_PORT = 41_997;

function readPort(): number {
  const raw = process.env.BB_RENDER_INVARIANTS_PORT;
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid BB_RENDER_INVARIANTS_PORT: ${raw}`);
  }
  return port;
}

const startedAt = Date.now();
const fixture = await startRenderFixture({ port: readPort() });
const pairingResponse = await fetch(
  `${fixture.serverUrl}/api/v1/access/pairings`,
  {
    method: "POST",
    headers: { authorization: fixture.harness.server.localAuthorization },
  },
);
const pairing = z
  .object({ code: z.string() })
  .parse(await pairingResponse.json());
process.stdout.write(
  `${JSON.stringify({
    serverUrl: fixture.serverUrl,
    signInUrl: `${fixture.serverUrl}/pair#code=${pairing.code}`,
    timelineThread: `${fixture.serverUrl}/threads/${fixture.timelineThreadId}`,
    questionThread: `${fixture.serverUrl}/threads/${fixture.questionThreadId}`,
    sidebarThreads: fixture.sidebarThreadIds.length,
    seededInMs: Date.now() - startedAt,
  })}\n`,
);

async function shutdown(): Promise<void> {
  await fixture.cleanup();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
await new Promise<never>(() => {});
