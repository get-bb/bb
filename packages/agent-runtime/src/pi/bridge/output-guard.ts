type ProcessWriteCallback = (error?: Error | null) => void;
type RedirectedProcessWrite = (
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | ProcessWriteCallback,
  callback?: ProcessWriteCallback,
) => boolean;

interface PiBridgeStdoutTakeoverState {
  forwardStderrDrain: (() => void) | undefined;
  originalStdoutWrite: typeof process.stdout.write;
  protocolStdoutWrite: (
    chunk: string,
    callback?: ProcessWriteCallback,
  ) => boolean;
}

let stdoutTakeoverState: PiBridgeStdoutTakeoverState | undefined;

export function takeOverPiBridgeStdout(): void {
  if (stdoutTakeoverState) {
    return;
  }

  const protocolStdoutWrite = process.stdout.write.bind(
    process.stdout,
  ) as PiBridgeStdoutTakeoverState["protocolStdoutWrite"];
  const stderrWrite = process.stderr.write.bind(
    process.stderr,
  ) as RedirectedProcessWrite;
  const originalStdoutWrite = process.stdout.write;

  stdoutTakeoverState = {
    forwardStderrDrain: undefined,
    originalStdoutWrite,
    protocolStdoutWrite,
  };

  process.stdout.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ProcessWriteCallback,
    callback?: ProcessWriteCallback,
  ): boolean => {
    const accepted =
      typeof encodingOrCallback === "function"
        ? stderrWrite(chunk, encodingOrCallback)
        : encodingOrCallback !== undefined
          ? stderrWrite(chunk, encodingOrCallback, callback)
          : callback
            ? stderrWrite(chunk, callback)
            : stderrWrite(chunk);

    const takeoverState = stdoutTakeoverState;
    if (!accepted && takeoverState && !takeoverState.forwardStderrDrain) {
      const forwardStderrDrain = (): void => {
        const state = stdoutTakeoverState;
        if (!state || state.forwardStderrDrain !== forwardStderrDrain) {
          return;
        }
        state.forwardStderrDrain = undefined;
        process.stdout.emit("drain");
      };
      takeoverState.forwardStderrDrain = forwardStderrDrain;
      process.stderr.once("drain", forwardStderrDrain);
    }

    return accepted;
  }) as typeof process.stdout.write;
}

export function restorePiBridgeStdout(): void {
  if (!stdoutTakeoverState) {
    return;
  }

  const { forwardStderrDrain, originalStdoutWrite } = stdoutTakeoverState;
  if (forwardStderrDrain) {
    process.stderr.off("drain", forwardStderrDrain);
  }
  process.stdout.write = originalStdoutWrite;
  stdoutTakeoverState = undefined;
}

export function writePiBridgeProtocol(text: string): void {
  const protocolStdoutWrite =
    stdoutTakeoverState?.protocolStdoutWrite ??
    (process.stdout.write.bind(
      process.stdout,
    ) as PiBridgeStdoutTakeoverState["protocolStdoutWrite"]);
  protocolStdoutWrite(text);
}
