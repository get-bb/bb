import { parentPort } from "node:worker_threads";

parentPort.on("message", (message) => {
  parentPort.postMessage({
    type: "failed",
    id: message.id,
    apiError: {
      status: 404,
      code: "thread_not_found",
      message: "Thread not found",
      details: undefined,
      retryable: undefined,
    },
    message: "Thread not found",
    stack: undefined,
  });
});
