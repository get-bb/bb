export function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export function methodNotAllowed(allow: "GET" | "POST"): Response {
  return jsonResponse({ error: "method_not_allowed" }, 405, { allow });
}
