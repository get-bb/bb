import { get } from "node:http";

function requestStatus(url, host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = get(url, { headers: { host } }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 500);
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`timed out requesting ${host}`));
    });
    request.once("error", reject);
  });
}

export async function waitForCloudService({
  url,
  host,
  serviceExited,
  timeoutMs = 30_000,
  retryDelayMs = 250,
  requestImpl = requestStatus,
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serviceExited()) throw new Error("Cloud service exited early");
    try {
      if ((await requestImpl(url, host, 1_000)) < 500) return;
    } catch {
      // Retry transport failures until the shared startup deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  throw new Error(`timed out waiting for ${host}`);
}
