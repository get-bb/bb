import { z } from "zod";
import { validateDirectServerUrl } from "../profiles/direct-url";
import { MOBILE_APP_SURFACE_HEADER } from "./app-surface";

const SERVER_MOVED_STATUS = 410;

const serverMovedBodySchema = z.object({
  code: z.literal("server_moved"),
  details: z.object({
    serverUrl: z.string().min(1),
    toHostName: z.string().min(1),
  }),
});

export interface ServerMovedResponse {
  serverUrl: string;
  toHostName: string;
}

export interface MobileFetchOptions {
  onAuthFailure?: (status: number) => void;
  onServerMoved?: (moved: ServerMovedResponse) => void;
}

export async function readServerMovedResponse(
  response: Response,
): Promise<ServerMovedResponse | null> {
  if (response.status !== SERVER_MOVED_STATUS) return null;
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return null;
  }
  const parsed = serverMovedBodySchema.safeParse(body);
  if (!parsed.success) return null;
  const validation = validateDirectServerUrl(parsed.data.details.serverUrl);
  if (!validation.ok) return null;
  return {
    serverUrl: validation.serverUrl,
    toHostName: parsed.data.details.toHostName,
  };
}

export function createMobileFetch(
  baseFetch: typeof fetch,
  options: MobileFetchOptions = {},
): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set(
      MOBILE_APP_SURFACE_HEADER.name,
      MOBILE_APP_SURFACE_HEADER.value,
    );
    const response = await baseFetch(input, { ...init, headers });
    if (response.status === 401 || response.status === 403) {
      options.onAuthFailure?.(response.status);
    }
    if (options.onServerMoved && response.status === SERVER_MOVED_STATUS) {
      const moved = await readServerMovedResponse(response);
      if (moved) options.onServerMoved(moved);
    }
    return response;
  };
}
