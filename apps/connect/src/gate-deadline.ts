export type GateStage =
  | "routing"
  | "tunnel-object"
  | "request-body"
  | "response-head"
  | "finishing";

export interface GateProgress {
  stage: GateStage;
}

export interface GateStall {
  stage: GateStage;
  method: string;
  host: string;
  path: string;
  deadlineMs: number;
}

interface WithGateDeadlineArgs {
  request: Request;
  deadlineMs: number;
  progress: GateProgress;
  run: () => Promise<Response>;
  onStall: (stall: GateStall) => void;
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
  work.then(
    (response) => response.body?.cancel().catch(() => {}),
    () => {},
  );
}

export async function withGateDeadline({
  request,
  deadlineMs,
  progress,
  run,
  onStall,
}: WithGateDeadlineArgs): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof STALLED>((resolve) => {
    timer = setTimeout(() => resolve(STALLED), deadlineMs);
  });
  const work = run();
  try {
    const winner = await Promise.race([work, deadline]);
    if (winner !== STALLED) return winner;
  } finally {
    clearTimeout(timer);
  }
  discardLateResponse(work);
  const url = new URL(request.url);
  onStall({
    stage: progress.stage,
    method: request.method,
    host: url.host,
    path: url.pathname,
    deadlineMs,
  });
  return new Response(
    `bb connect: timed out ${STALL_MESSAGES[progress.stage]} (stage: ${progress.stage})\n`,
    {
      status: 504,
      headers: { "content-type": "text/plain; charset=utf-8" },
    },
  );
}
