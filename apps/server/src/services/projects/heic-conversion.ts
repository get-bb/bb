import { Worker } from "node:worker_threads";
import { extname } from "node:path";
import { ApiError } from "../../errors.js";
import { heicWorkerSource } from "../../generated/heic-worker.js";

const HEIF_MIME_TYPES = new Set([
  "image/heic",
  "image/heic-sequence",
  "image/heif",
  "image/heif-sequence",
]);
const CONVERSION_TIMEOUT_MS = 30_000;
const MAX_WAITING_CONVERSIONS = 3;
const waitingConversions: (() => void)[] = [];
let converting = false;

function conversionError(): ApiError {
  return new ApiError(
    400,
    "invalid_request",
    "Could not convert HEIC/HEIF image to PNG",
  );
}

async function convertToPng(file: File): Promise<Uint8Array<ArrayBuffer>> {
  if (converting && waitingConversions.length >= MAX_WAITING_CONVERSIONS) {
    throw new ApiError(
      429,
      "rate_limited",
      "HEIC conversion is busy. Try again shortly.",
      { retryable: true },
    );
  }
  if (converting) {
    await new Promise<void>((resolve) => waitingConversions.push(resolve));
  } else {
    converting = true;
  }
  try {
    const worker = new Worker(heicWorkerSource, {
      eval: true,
      execArgv: [],
      workerData: new Uint8Array(await file.arrayBuffer()),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ApiError(
                400,
                "invalid_request",
                "HEIC/HEIF conversion timed out",
              ),
            ),
          CONVERSION_TIMEOUT_MS,
        );
        worker.once("message", (message: unknown) => {
          if (message instanceof Uint8Array && message.byteLength > 0) {
            resolve(new Uint8Array(message));
          } else reject(conversionError());
        });
        worker.once("error", () => reject(conversionError()));
        worker.once("exit", () => reject(conversionError()));
      });
    } finally {
      clearTimeout(timer);
      await worker.terminate();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw conversionError();
  } finally {
    const next = waitingConversions.shift();
    if (next) next();
    else converting = false;
  }
}

export async function normalizeHeifAttachment(file: File): Promise<File> {
  const mimeType = (file.type.split(";")[0] ?? "").trim().toLowerCase();
  const extension = extname(file.name);
  if (
    !HEIF_MIME_TYPES.has(mimeType) &&
    !(mimeType === "" && /\.(heic|heif)$/iu.test(extension))
  ) {
    return file;
  }
  const bytes = await convertToPng(file);
  const name = extension ? file.name.slice(0, -extension.length) : file.name;
  return new File([bytes], `${name}.png`, { type: "image/png" });
}
