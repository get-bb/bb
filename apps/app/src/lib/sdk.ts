import { createBrowserBbSdk } from "@bb/sdk/browser";
import { fetchWithAppSurface } from "./app-surface";

const BASE_URL = globalThis.window?.location.origin ?? "http://localhost";

export const sdk = createBrowserBbSdk({
  baseUrl: BASE_URL,
  fetch: fetchWithAppSurface,
});

export { BbHttpError } from "@bb/sdk/browser";
