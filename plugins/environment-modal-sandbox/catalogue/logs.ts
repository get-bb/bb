export function createBuildLogWriter(
  write: (kind: "log" | "truncated", text: string) => void,
) {
  let pending = "";
  let dropping = false;
  return {
    append(text: string) {
      for (const part of text.split(/(?<=\n)/)) {
        const complete = part.endsWith("\n");
        if (!dropping) {
          pending += part;
          if (Buffer.byteLength(pending) > 65536) {
            write(
              "truncated",
              "An oversized log line was omitted at the 64 KiB limit",
            );
            pending = "";
            dropping = true;
          } else if (complete) {
            write("log", pending);
            pending = "";
          }
        }
        if (complete) dropping = false;
      }
    },
    flush() {
      if (pending) write("log", pending);
      pending = "";
    },
  };
}
