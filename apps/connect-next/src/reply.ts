export type ReplyHeaders = Record<string, string | string[]>;

export interface Reply {
  status: number;
  headers: ReplyHeaders;
  body: string | Buffer;
}

export function text(body: string, status: number): Reply {
  return {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body,
  };
}

export function json(
  value: unknown,
  status: number,
  headers: ReplyHeaders = {},
): Reply {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(value),
  };
}

export function redirect(location: string, status: number): Reply {
  return { status, headers: { location }, body: "" };
}

export async function replyFromResponse(response: Response): Promise<Reply> {
  const headers: ReplyHeaders = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return {
    status: response.status,
    headers,
    body: Buffer.from(await response.arrayBuffer()),
  };
}
