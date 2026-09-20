// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownImage } from "@/components/ui/markdown-image";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { makeThreadTimelineResponse } from "@/test/fixtures/thread-responses";
import { sdk } from "@/lib/sdk";
import { TimelineImageMetadata } from "./TimelineImageMetadata";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: { saveImageMetadata: vi.fn().mockResolvedValue({ ok: true }) },
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("reserves server metadata before fetching on a fresh mount and persists changed dimensions", async () => {
  let intersect: IntersectionObserverCallback;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const source = "https://example.com/portrait.png?v=1";
  const queryClient = new QueryClient();
  const key = threadTimelineQueryKey("thr_image");
  queryClient.setQueryData(
    key,
    makeThreadTimelineResponse({
      imageMetadata: [{ source, width: 780, height: 1688, etag: null }],
    }),
  );
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TimelineImageMetadata threadId="thr_image">
        <MarkdownImage src={source} alt="Portrait" />
      </TimelineImageMetadata>
    </QueryClientProvider>,
  );
  const image = view.getByAltText("Portrait");
  expect(image.style.aspectRatio).toBe("780 / 1688");
  expect(image.hasAttribute("src")).toBe(false);
  act(() =>
    intersect(
      [{ target: image, isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  Object.defineProperties(image, {
    complete: { value: true },
    naturalWidth: { value: 1440 },
    naturalHeight: { value: 900 },
  });
  fireEvent.load(image);
  await waitFor(() =>
    expect(sdk.threads.saveImageMetadata).toHaveBeenCalledWith({
      threadId: "thr_image",
      source,
      width: 1440,
      height: 900,
      etag: null,
    }),
  );
  await waitFor(() =>
    expect(queryClient.getQueryData(key)).toMatchObject({
      imageMetadata: [{ source, width: 1440, height: 900, etag: null }],
    }),
  );
  await waitFor(() => expect(image.dataset.markdownImageState).toBe("ready"));
  expect(sdk.threads.saveImageMetadata).toHaveBeenCalledTimes(1);
});
