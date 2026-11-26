import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Browser, BrowserContext, Page, Request } from "playwright-core";
import { z } from "zod";

const PROBE_SCRIPT = readFileSync(
  new URL("./render-probe.js", import.meta.url),
  "utf8",
);

const QUIET_MS = 1_000;
const STARTUP_QUIET_MS = 3_000;
const SETTLE_TIMEOUT_MS = 30_000;
const PENDING_REQUEST_POLL_MS = 50;
const VIOLATION_LIST_LIMIT = 40;

const renderSchema = z.object({
  name: z.string(),
  mounted: z.boolean(),
  sidebarThreadId: z.string().nullable(),
  timelineRowId: z.string().nullable(),
  location: z.string(),
  insideContainer: z.boolean(),
});

const reportSchema = z.object({
  commits: z.number(),
  commitsSinceLoad: z.number(),
  errors: z.array(z.string()),
  renders: z.array(renderSchema),
});

export type Render = z.infer<typeof renderSchema>;
export type RenderReport = z.infer<typeof reportSchema>;

export interface RenderSession {
  page: Page;
  reset(): Promise<void>;
  settle(): Promise<void>;
  report(options?: { container?: string }): Promise<RenderReport>;
  close(): Promise<void>;
}

const localSessionSchema = z.object({
  token: z.string(),
  cookieName: z.string(),
});

export async function signInBrowserContext(
  context: BrowserContext,
  serverUrl: string,
  localAuthorization: string,
): Promise<void> {
  const response = await fetch(`${serverUrl}/api/v1/access/local-sessions`, {
    method: "POST",
    headers: {
      authorization: localAuthorization,
      "content-type": "application/json",
    },
    body: JSON.stringify({ label: `render invariants ${randomUUID()}` }),
  });
  if (!response.ok) {
    throw new Error(
      `local browser sign-in failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  const session = localSessionSchema.parse(await response.json());
  await context.addCookies([
    {
      name: session.cookieName,
      value: session.token,
      url: serverUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

export async function openThread(
  browser: Browser,
  serverUrl: string,
  localAuthorization: string,
  threadId: string,
): Promise<RenderSession> {
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await signInBrowserContext(context, serverUrl, localAuthorization);
  await context.addInitScript({ content: PROBE_SCRIPT });
  const page = await context.newPage();
  const pendingRequests = new Set<Request>();
  let lastRequestActivityAt = Date.now();
  const settleRequest = (request: Request) => {
    pendingRequests.delete(request);
    lastRequestActivityAt = Date.now();
  };
  page.on("request", (request) => {
    pendingRequests.add(request);
    lastRequestActivityAt = Date.now();
  });
  page.on("response", (response) => settleRequest(response.request()));
  page.on("requestfinished", settleRequest);
  page.on("requestfailed", settleRequest);
  await page.goto(`${serverUrl}/threads/${threadId}`);
  await page.waitForSelector("[data-timeline-row-id]", {
    timeout: SETTLE_TIMEOUT_MS,
  });
  await page.waitForSelector("a[data-sidebar-thread-id]", {
    timeout: SETTLE_TIMEOUT_MS,
  });

  const settleFor = async (quietMs: number) => {
    const since = await page.evaluate(() => window.__renderProbe.renderCount());
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    try {
      for (;;) {
        await page.waitForFunction(
          (minimum) => window.__renderProbe.quietFor() >= minimum,
          quietMs,
          { timeout: Math.max(1, deadline - Date.now()), polling: 100 },
        );
        const requestsQuietFor = Date.now() - lastRequestActivityAt;
        if (pendingRequests.size === 0 && requestsQuietFor >= quietMs) return;
        if (Date.now() >= deadline) {
          throw new Error(
            `Requests still awaiting a response: ${[...pendingRequests].map((request) => `${request.method()} ${request.url()}`).join(", ")}`,
          );
        }
        await page.waitForTimeout(
          pendingRequests.size === 0
            ? quietMs - requestsQuietFor
            : PENDING_REQUEST_POLL_MS,
        );
      }
    } catch (error) {
      const report = reportSchema.parse(
        await page.evaluate(
          (from) => window.__renderProbe.report(null, from),
          since,
        ),
      );
      throw new Error(
        `The page never stayed free of React commits and pending requests for ${quietMs} ms within ${SETTLE_TIMEOUT_MS} ms. It kept rendering:\n${summarize(report.renders).join("\n")}`,
        { cause: error },
      );
    }
  };
  const settle = () => settleFor(QUIET_MS);
  await settleFor(STARTUP_QUIET_MS);

  return {
    page,
    settle,
    reset: () => page.evaluate(() => window.__renderProbe.reset()),
    async report(options = {}) {
      const raw = await page.evaluate(
        (container) => window.__renderProbe.report(container, 0),
        options.container ?? null,
      );
      const report = reportSchema.parse(raw);
      if (report.commitsSinceLoad === 0) {
        throw new Error(
          "The render probe saw no React commits; the page is not running the profiling build with the probe attached.",
        );
      }
      if (report.errors.length > 0) {
        throw new Error(`The render probe failed: ${report.errors.join("; ")}`);
      }
      return report;
    },
    close: () => context.close(),
  };
}

export function summarize(renders: readonly Render[]): string[] {
  const counts = new Map<string, number>();
  for (const render of renders) {
    const key = `${render.name} in ${render.location}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const lines = [...counts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .map(([key, count]) => `${count}x ${key}`);
  if (lines.length <= VIOLATION_LIST_LIMIT) return lines;
  return [
    ...lines.slice(0, VIOLATION_LIST_LIMIT),
    `... ${lines.length - VIOLATION_LIST_LIMIT} more`,
  ];
}

export function rerendered(report: RenderReport): Render[] {
  return report.renders.filter((render) => !render.mounted);
}
