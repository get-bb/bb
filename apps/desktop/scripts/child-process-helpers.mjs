import { once } from "node:events";

export async function sleep(delayMs) {
  await new Promise((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

export async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }

  return await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolvePromise(false);
    }, timeoutMs);

    const handleExit = () => {
      cleanup();
      resolvePromise(true);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", handleExit);
    };

    child.once("exit", handleExit);
  });
}

export async function forwardSignalsAndMirrorExit(child) {
  process.once("SIGINT", () => {
    child.kill("SIGINT");
  });
  process.once("SIGTERM", () => {
    child.kill("SIGTERM");
  });

  const [code, signal] = await once(child, "exit");
  if (typeof code === "number") {
    process.exitCode = code;
  } else {
    process.exitCode = signal === null ? 1 : 128;
  }
}
