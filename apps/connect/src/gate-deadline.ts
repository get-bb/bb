export type GateStage =
  | "routing"
  | "tunnel-object"
  | "request-body"
  | "response-head"
  | "finishing";

export interface GateProgress {
  stage: GateStage;
  tunnelObjectAttempts: number;
  routingKey: string | null;
}

export interface GateDelay {
  kind: "slow" | "stall";
  stage: GateStage;
  method: string;
  host: string;
  path: string;
  elapsedMs: number;
  tunnelObjectAttempts: number;
}

interface WithGateDeadlineArgs {
  request: Request;
  deadlineMs: number;
  maxWaitMs: number;
  slowAfterMs: number | null;
  progress: GateProgress;
  run: (signal: AbortSignal) => Promise<Response>;
  tunnelServing: () => Promise<boolean>;
  onDelay: (delay: GateDelay) => void;
}

const STALL_MESSAGES: Record<GateStage, string> = {
  routing: "checking access",
  "tunnel-object": "reaching this server's tunnel",
  "request-body": "forwarding the request body",
  "response-head": "waiting for the tunnel client",
  finishing: "finishing the response",
};

function discardLateResponse(work: Promise<Response>): void {
  void work
    .then((response) => {
      const socket = response.webSocket;
      if (socket != null) {
        socket.accept();
        socket.close(1000, "request deadline exceeded");
      }
      return response.body?.cancel();
    })
    .catch(() => {});
}

export async function withGateDeadline({
  request,
  deadlineMs,
  maxWaitMs,
  slowAfterMs,
  progress,
  run,
  tunnelServing,
  onDelay,
}: WithGateDeadlineArgs): Promise<Response> {
  const url = new URL(request.url);
  const startedAt = Date.now();
  const report = (kind: GateDelay["kind"], elapsedMs: number) =>
    onDelay({
      kind,
      stage: progress.stage,
      method: request.method,
      host: url.host,
      path: url.pathname,
      elapsedMs,
      tunnelObjectAttempts: progress.tunnelObjectAttempts,
    });
  let settled = false;
  let reportedSlowTunnel = false;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const slowTimer =
    slowAfterMs === null
      ? undefined
      : setTimeout(() => report("slow", slowAfterMs), slowAfterMs);
  const waitingOnLiveTunnel = async (elapsedMs: number) =>
    progress.stage === "response-head" &&
    elapsedMs + deadlineMs <= maxWaitMs &&
    (await tunnelServing());
  const deadline = new Promise<number>((resolve) => {
    const arm = () => {
      deadlineTimer = setTimeout(async () => {
        const elapsedMs = Date.now() - startedAt;
        if (!(await waitingOnLiveTunnel(elapsedMs))) {
          resolve(elapsedMs);
          return;
        }
        if (settled) return;
        if (!reportedSlowTunnel) {
          reportedSlowTunnel = true;
          report("slow", elapsedMs);
        }
        arm();
      }, deadlineMs);
    };
    arm();
  });
  const abort = new AbortController();
  const work = run(abort.signal);
  let stalledAfterMs: number;
  try {
    const winner = await Promise.race([work, deadline]);
    if (typeof winner !== "number") return winner;
    stalledAfterMs = winner;
  } finally {
    settled = true;
    clearTimeout(deadlineTimer);
    clearTimeout(slowTimer);
  }
  abort.abort();
  discardLateResponse(work);
  report("stall", stalledAfterMs);
  return new Response(
    `bb connect: timed out ${STALL_MESSAGES[progress.stage]} (stage: ${progress.stage})\n`,
    {
      status: 504,
      headers: { "content-type": "text/plain; charset=utf-8" },
    },
  );
}
