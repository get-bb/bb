import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("PartySocket", () => {
  it("absorbs a late error after timing out a connecting WebSocket", async () => {
    const script = `
      import { EventEmitter } from "node:events";
      import PartySocket from "partysocket/ws";

      let closeCount = 0;

      class ConnectingWebSocket extends EventEmitter {
        readyState = 0;
        binaryType = "blob";

        addEventListener(type, listener) {
          this.on(type, listener);
        }

        removeEventListener(type, listener) {
          this.off(type, listener);
        }

        close() {
          closeCount += 1;
          process.nextTick(() => {
            this.emit(
              "error",
              new Error("WebSocket was closed before the connection was established"),
            );
          });
        }
      }

      new PartySocket("ws://unreachable.test", [], {
        WebSocket: ConnectingWebSocket,
        connectionTimeout: 1,
        maxRetries: 0,
        minReconnectionDelay: 0,
      });

      setTimeout(() => {
        if (closeCount !== 1) {
          throw new Error(\`Expected one timed-out connection, received \${closeCount}\`);
        }
        process.stdout.write("survived late WebSocket error");
      }, 25);
    `;

    const result = await execFileAsync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { cwd: import.meta.dirname },
    );

    expect(result).toMatchObject({
      stdout: "survived late WebSocket error",
      stderr: "",
    });
  });
});
