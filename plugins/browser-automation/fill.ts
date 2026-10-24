import { getDomain } from "tldts";
import { z } from "zod";
import { fillCodeSchema, type FillCode } from "./contracts.js";
import type { PreviewSocket } from "./preview.js";

const socketOpen = 1;
const isolatedWorld = "bb-private-fill";
const replySchema = z.object({
  id: z.number().int(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});
const attachedSchema = z.object({ sessionId: z.string().min(1) });
const frameTreeSchema = z.object({
  frameTree: z.object({
    frame: z.object({ id: z.string().min(1), url: z.string() }),
  }),
});
const worldSchema = z.object({ executionContextId: z.number().int() });
const callSchema = z.object({
  result: z.object({ value: z.unknown().optional() }),
  exceptionDetails: z.unknown().optional(),
});
const pagesSchema = z.array(
  z.object({ id: z.string().min(1), name: z.string().nullable() }).loose(),
);

const fillFunction = `function (origin, selector, value) {
  if (location.origin !== origin) return "navigated";
  let element;
  try {
    element = document.querySelector(selector);
  } catch {
    return "element_not_found";
  }
  if (!element) return "element_not_found";
  const textTypes = ["text", "password", "email", "tel", "number", "search", "url"];
  const prototype =
    element instanceof HTMLInputElement && textTypes.includes(element.type)
      ? HTMLInputElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : null;
  if (!prototype || element.disabled || element.readOnly)
    return "element_not_fillable";
  element.style.setProperty("-webkit-text-security", "disc", "important");
  element.focus();
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return "ok";
}`;

export function siteOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname) return null;
  const host = parsed.hostname.toLowerCase();
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}

export function sameSite(actual: string, expected: string): boolean {
  const site = siteOf(actual);
  return site !== null && site === siteOf(expected);
}

export function redactFilled(
  text: string,
  values: ReadonlySet<string>,
): string {
  const forms = new Set<string>();
  for (const value of values) {
    forms.add(value);
    forms.add(JSON.stringify(value).slice(1, -1));
  }
  for (const form of [...forms].sort((a, b) => b.length - a.length))
    if (form) text = text.split(form).join("[filled value]");
  return text;
}

export function findPageTarget(listing: string, page: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(listing);
  } catch {
    return null;
  }
  const pages = pagesSchema.safeParse(parsed);
  if (!pages.success) return null;
  return pages.data.find((entry) => entry.name === page)?.id ?? null;
}

export async function fillTarget(args: {
  connectionUrl: string;
  targetId: string;
  selector: string;
  value: string;
  expectedOrigin: string;
  signal: AbortSignal;
  openSocket?: (url: string) => PreviewSocket;
}): Promise<FillCode> {
  const openSocket: (url: string) => PreviewSocket =
    args.openSocket ?? ((url) => new WebSocket(url));
  const socket = openSocket(args.connectionUrl);
  const calls = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  let nextId = 0;
  let closed = false;
  const fail = () => {
    closed = true;
    for (const call of calls.values()) call.reject(new Error("closed"));
    calls.clear();
  };
  socket.addEventListener("message", (event: { data: unknown }) => {
    if (typeof event.data !== "string") return;
    let message: unknown;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    const reply = replySchema.safeParse(message);
    if (!reply.success) return;
    const call = calls.get(reply.data.id);
    if (!call) return;
    calls.delete(reply.data.id);
    if (reply.data.error) call.reject(new Error("cdp"));
    else call.resolve(reply.data.result);
  });
  socket.addEventListener("close", fail);
  socket.addEventListener("error", fail);
  const abort = () => {
    fail();
    socket.close();
  };
  args.signal.addEventListener("abort", abort, { once: true });
  const send = (
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown> => {
    if (closed || socket.readyState !== socketOpen)
      return Promise.reject(new Error("closed"));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      calls.set(id, { resolve, reject });
      socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId === undefined ? {} : { sessionId }),
        }),
      );
    });
  };
  try {
    if (socket.readyState !== socketOpen)
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve());
        socket.addEventListener("close", () => reject(new Error("closed")));
        socket.addEventListener("error", () => reject(new Error("closed")));
        args.signal.addEventListener("abort", () => reject(new Error("abort")));
      });
    let sessionId: string;
    try {
      sessionId = attachedSchema.parse(
        await send("Target.attachToTarget", {
          targetId: args.targetId,
          flatten: true,
        }),
      ).sessionId;
    } catch {
      return "page_not_found";
    }
    const { frame } = frameTreeSchema.parse(
      await send("Page.getFrameTree", {}, sessionId),
    ).frameTree;
    if (!sameSite(frame.url, args.expectedOrigin)) return "origin_mismatch";
    const verifiedOrigin = new URL(frame.url).origin;
    let contextId: number;
    try {
      contextId = worldSchema.parse(
        await send(
          "Page.createIsolatedWorld",
          {
            frameId: frame.id,
            worldName: isolatedWorld,
            grantUniveralAccess: false,
          },
          sessionId,
        ),
      ).executionContextId;
    } catch {
      return "navigated";
    }
    let called: z.infer<typeof callSchema>;
    try {
      called = callSchema.parse(
        await send(
          "Runtime.callFunctionOn",
          {
            functionDeclaration: fillFunction,
            executionContextId: contextId,
            arguments: [
              { value: verifiedOrigin },
              { value: args.selector },
              { value: args.value },
            ],
            returnByValue: true,
            silent: true,
          },
          sessionId,
        ),
      );
    } catch {
      return "navigated";
    }
    if (called.exceptionDetails !== undefined) return "fill_failed";
    const code = fillCodeSchema.safeParse(called.result.value);
    return code.success ? code.data : "fill_failed";
  } catch {
    return "fill_failed";
  } finally {
    args.signal.removeEventListener("abort", abort);
    fail();
    socket.close();
  }
}
