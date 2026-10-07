export type GateStage =
  | "routing"
  | "tunnel-object"
  | "request-body"
  | "response-head"
  | "finishing";

export interface GateProgress {
  stage: GateStage;
  tunnelObjectAttempts: number;
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
  slowAfterMs: number | null;
  progress: GateProgress;
  run: () => Promise<Response>;
  onDelay: (delay: GateDelay) => void;
}

const STALL_MESSAGES: Record<GateStage, string> = {
  routing: "checking access",
  "tunnel-object": "reaching this server's tunnel",
  "request-body": "forwarding the request body",
  "response-head": "waiting for the tunnel client",
  finishing: "finishing the response",
};

const STALLED = Symbol("stalled");

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
  slowAfterMs,
  progress,
  run,
  onDelay,
}: WithGateDeadlineArgs): Promise<Response> {
  const url = new URL(request.url);
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
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const slowTimer =
    slowAfterMs === null
      ? undefined
      : setTimeout(() => report("slow", slowAfterMs), slowAfterMs);
  const deadline = new Promise<typeof STALLED>((resolve) => {
    deadlineTimer = setTimeout(() => resolve(STALLED), deadlineMs);
  });
  const work = run();
  try {
    const winner = await Promise.race([work, deadline]);
    if (winner !== STALLED) return winner;
  } finally {
    clearTimeout(deadlineTimer);
    clearTimeout(slowTimer);
  }
  discardLateResponse(work);
  report("stall", deadlineMs);
  return new Response(
    `bb connect: timed out ${STALL_MESSAGES[progress.stage]} (stage: ${progress.stage})\n`,
    {
      status: 504,
      headers: { "content-type": "text/plain; charset=utf-8" },
    },
  );
}
