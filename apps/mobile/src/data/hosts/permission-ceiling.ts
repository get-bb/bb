import { extractErrorMessage } from "@bb/core-ui";
import { hostSchema, type Host, type PermissionMode } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";

export interface UpdateHostPermissionCeilingRequest {
  hostId: string;
  maxPermissionMode: PermissionMode;
}

/**
 * `PATCH /hosts/:id/permission-ceiling`. Deliberately absent from the SDK
 * (and the `bb` CLI): the ceiling is what stops one paired machine from
 * running privileged work on another, so only an owner session — the
 * desktop-session cookie here, or loopback Direct mode — may change it.
 * Goes through the profile's fetch (app-surface header, auth reporting,
 * the native cookie jar).
 */
export async function updateHostPermissionCeiling(
  client: { serverUrl: string; fetch: typeof fetch },
  request: UpdateHostPermissionCeilingRequest,
): Promise<Host> {
  const base = client.serverUrl.replace(/\/+$/u, "");
  const response = await client.fetch(
    `${base}/api/v1/hosts/${encodeURIComponent(request.hostId)}/permission-ceiling`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ maxPermissionMode: request.maxPermissionMode }),
    },
  );
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const code =
      typeof body === "object" && body !== null && "code" in body
        ? (body as { code?: unknown }).code
        : null;
    throw new BbHttpError({
      body,
      code: typeof code === "string" ? code : null,
      message:
        extractErrorMessage(body) ??
        (response.statusText ||
          `Request failed with status ${response.status}`),
      status: response.status,
    });
  }
  // The route answers the full host row (status included).
  return hostSchema.parse(body);
}
