type ProcessWriteCallback = (error?: Error | null) => void;
type RedirectedProcessWrite = (
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | ProcessWriteCallback,
  callback?: ProcessWriteCallback,
) => boolean;

interface PiBridgeStdoutTakeoverState {
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

  process.stdout.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ProcessWriteCallback,
    callback?: ProcessWriteCallback,
  ): boolean => {
    if (typeof encodingOrCallback === "function") {
      return stderrWrite(chunk, encodingOrCallback);
    }
    if (encodingOrCallback !== undefined) {
      return stderrWrite(chunk, encodingOrCallback, callback);
    }
    if (callback) {
      return stderrWrite(chunk, callback);
    }
    return stderrWrite(chunk);
  }) as typeof process.stdout.write;

  stdoutTakeoverState = {
    originalStdoutWrite,
    protocolStdoutWrite,
  };
}

export function restorePiBridgeStdout(): void {
  if (!stdoutTakeoverState) {
    return;
  }

  process.stdout.write = stdoutTakeoverState.originalStdoutWrite;
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
