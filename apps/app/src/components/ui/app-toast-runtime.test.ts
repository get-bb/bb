import { toast } from "sonner";
import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

it("replays a toast fired before the toaster has loaded once it attaches", async () => {
  const runtime = await import("./app-toast-runtime");
  const received: unknown[] = [];

  runtime.withSonnerToast((sonnerToast) => received.push(sonnerToast));

  expect(received).toEqual([]);
  expect(runtime.isToasterRequested()).toBe(true);

  runtime.attachSonnerToast(toast);

  expect(received).toEqual([toast]);
});
