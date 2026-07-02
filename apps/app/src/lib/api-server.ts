import { createApiClient } from "@bb/server-contract";
import { fetchWithAppSurface } from "./app-surface";

const BASE_URL =
  typeof window === "undefined" ? "http://localhost" : window.location.origin;

const client = createApiClient(BASE_URL, { fetch: fetchWithAppSurface });

export const apiClient = client.api.v1;

export function toRelativeUrl(url: URL): string {
  return `${url.pathname}${url.search}`;
}
