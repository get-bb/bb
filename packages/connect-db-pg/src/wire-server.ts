import { type Socket, createServer } from "node:net";
import type { PGlite } from "@electric-sql/pglite";

const SSL_REQUEST = 80_877_103;
const GSS_REQUEST = 80_877_104;
const CANCEL_REQUEST = 80_877_102;
const BATCH_END = new Set(["S", "Q"]);
const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;

interface WireJob {
  connection: number;
  bytes: Uint8Array;
  write(data: Uint8Array): void;
  resolve(): void;
  reject(error: unknown): void;
}

function simpleQuery(sql: string): Uint8Array {
  const text = Buffer.from(`${sql}\0`, "utf8");
  const message = Buffer.alloc(5 + text.length);
  message.write("Q", 0, "latin1");
  message.writeInt32BE(4 + text.length, 1);
  text.copy(message, 5);
  return new Uint8Array(message);
}

function fatalError(code: string, text: string): Buffer {
  const fields = Buffer.from(`SFATAL\0VFATAL\0C${code}\0M${text}\0\0`, "utf8");
  const message = Buffer.alloc(5 + fields.length);
  message.write("E", 0, "latin1");
  message.writeInt32BE(4 + fields.length, 1);
  fields.copy(message, 5);
  return message;
}

interface SessionOptions {
  idleInTransactionTimeoutMs: number;
  onIdleInTransaction(connection: number): void;
}

function wireSession(pglite: PGlite, options: SessionOptions) {
  const jobs: WireJob[] = [];
  let owner: number | null = null;
  let running = false;
  let idleTimer: NodeJS.Timeout | null = null;

  const clearIdleTimer = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
  };
  const armIdleTimer = (connection: number) => {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (owner === connection) options.onIdleInTransaction(connection);
    }, options.idleInTransactionTimeoutMs);
    idleTimer.unref();
  };
  const next = (): WireJob | undefined => {
    if (owner === null) return jobs.shift();
    const index = jobs.findIndex((job) => job.connection === owner);
    return index === -1 ? undefined : jobs.splice(index, 1)[0];
  };
  const pump = async () => {
    if (running) return;
    running = true;
    try {
      for (let job = next(); job; job = next()) {
        clearIdleTimer();
        try {
          await pglite.execProtocolRawStream(job.bytes, {
            onRawData: job.write,
          });
          job.resolve();
        } catch (error) {
          job.reject(error);
        }
        owner = pglite.isInTransaction() ? job.connection : null;
        if (
          owner !== null &&
          !jobs.some((queued) => queued.connection === owner)
        ) {
          armIdleTimer(owner);
        }
      }
    } finally {
      running = false;
    }
  };
  const enqueue = (
    connection: number,
    bytes: Uint8Array,
    write: (data: Uint8Array) => void,
    first = false,
  ) =>
    new Promise<void>((resolve, reject) => {
      const job = { connection, bytes, write, resolve, reject };
      if (first) jobs.unshift(job);
      else jobs.push(job);
      void pump();
    });
  return {
    execute(
      connection: number,
      bytes: Uint8Array,
      write: (data: Uint8Array) => void,
    ) {
      return enqueue(connection, bytes, write);
    },
    async release(connection: number) {
      for (let index = jobs.length - 1; index >= 0; index -= 1) {
        const job = jobs[index];
        if (job?.connection !== connection) continue;
        jobs.splice(index, 1);
        job.resolve();
      }
      if (owner !== connection) return;
      clearIdleTimer();
      await enqueue(connection, simpleQuery("ROLLBACK"), () => {}, true);
    },
    stop() {
      clearIdleTimer();
    },
  };
}

export interface ServePgliteOptions {
  host?: string;
  port?: number;
  idleInTransactionTimeoutMs?: number;
  onError?(error: unknown): void;
}

export interface PgliteWireServer {
  host: string;
  port: number;
  connectionString: string;
  close(): Promise<void>;
}

export function servePglite(
  pglite: PGlite,
  options: ServePgliteOptions = {},
): Promise<PgliteWireServer> {
  const host = options.host ?? "127.0.0.1";
  const sockets = new Map<number, Socket>();
  const session = wireSession(pglite, {
    idleInTransactionTimeoutMs:
      options.idleInTransactionTimeoutMs ??
      DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    onIdleInTransaction(connection) {
      const socket = sockets.get(connection);
      if (socket === undefined) return;
      socket.end(
        fatalError(
          "25P03",
          "terminating connection due to idle-in-transaction timeout",
        ),
        () => socket.destroy(),
      );
    },
  });
  const releases = new Set<Promise<void>>();
  let connections = 0;
  const server = createServer((socket) => {
    const connection = (connections += 1);
    sockets.set(connection, socket);
    let buffered = Buffer.alloc(0);
    let pending: Buffer[] = [];
    let started = false;
    let queue = Promise.resolve();
    const write = (data: Uint8Array) => {
      if (socket.writable) socket.write(data);
    };
    const send = (bytes: Buffer) => {
      queue = queue.then(() =>
        session
          .execute(connection, new Uint8Array(bytes), write)
          .catch((error: unknown) => {
            options.onError?.(error);
            if (!socket.writable) {
              socket.destroy();
              return;
            }
            socket.end(fatalError("XX000", String(error)), () =>
              socket.destroy(),
            );
          }),
      );
    };
    socket.on("data", (chunk) => {
      buffered =
        buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
      while (buffered.length > 0) {
        if (!started) {
          if (buffered.length < 8) return;
          const length = buffered.readInt32BE(0);
          if (buffered.length < length) return;
          const code = buffered.readInt32BE(4);
          const message = buffered.subarray(0, length);
          buffered = buffered.subarray(length);
          if (code === SSL_REQUEST || code === GSS_REQUEST) {
            socket.write("N");
            continue;
          }
          if (code === CANCEL_REQUEST) {
            socket.destroy();
            return;
          }
          started = true;
          send(Buffer.from(message));
          continue;
        }
        if (buffered.length < 5) return;
        const length = 1 + buffered.readInt32BE(1);
        if (buffered.length < length) return;
        const type = String.fromCharCode(buffered[0] ?? 0);
        const message = buffered.subarray(0, length);
        buffered = buffered.subarray(length);
        if (type === "X") {
          socket.end();
          return;
        }
        pending.push(Buffer.from(message));
        if (BATCH_END.has(type)) {
          send(Buffer.concat(pending));
          pending = [];
        }
      }
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      sockets.delete(connection);
      const released = queue
        .then(() => session.release(connection))
        .catch((error: unknown) => options.onError?.(error))
        .finally(() => releases.delete(released));
      releases.add(released);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("PGlite wire server has no TCP address"));
        return;
      }
      resolve({
        host,
        port: address.port,
        connectionString: `postgresql://postgres:postgres@${host}:${address.port}/postgres`,
        close: async () => {
          const closed = new Promise<void>((done) =>
            server.close(() => done()),
          );
          for (const socket of sockets.values()) socket.destroy();
          await closed;
          while (releases.size > 0) await Promise.all(releases);
          session.stop();
        },
      });
    });
  });
}
