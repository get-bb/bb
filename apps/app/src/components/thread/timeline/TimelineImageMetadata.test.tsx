// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useContext } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownImage } from "@/components/ui/markdown-image";
import { MarkdownImageMetadataContext } from "@/components/ui/markdown-image-dimensions";
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
  vi.mocked(sdk.threads.saveImageMetadata).mockResolvedValue({ ok: true });
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
      [
        {
          target: image,
          isIntersecting: true,
          intersectionRatio: 1,
          time: 0,
          boundingClientRect: image.getBoundingClientRect(),
          intersectionRect: image.getBoundingClientRect(),
          rootBounds: null,
        },
      ],
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

it("does not replay completed loads when two mounted versions of one source disagree", async () => {
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
  let version = 0;
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => `blob:revision-${++version}`;
      static revokeObjectURL = vi.fn();
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => ({
      ok: true,
      headers: new Headers({ etag: `"revision-${version + 1}"` }),
      blob: async () => new Blob(["image"]),
    })),
  );
  const acknowledgements: Array<() => void> = [];
  vi.mocked(sdk.threads.saveImageMetadata).mockImplementation(
    () =>
      new Promise((resolve) =>
        acknowledgements.push(() => resolve({ ok: true })),
      ),
  );
  const source =
    "/api/v1/threads/thr_image/host-files/content?path=%2Fsame.png";
  const other = "https://example.com/other.png";
  const queryClient = new QueryClient();
  const key = threadTimelineQueryKey("thr_image");
  queryClient.setQueryData(
    key,
    makeThreadTimelineResponse({ imageMetadata: [] }),
  );
  function SavedMetadata() {
    const metadata = useContext(MarkdownImageMetadataContext);
    return (
      <output data-testid="saved">
        {metadata?.read(source)?.etag}|{metadata?.read(other)?.width}
      </output>
    );
  }
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TimelineImageMetadata threadId="thr_image">
        <MarkdownImage src={source} alt="Earlier" />
        <MarkdownImage src={source} alt="Later" />
        <SavedMetadata />
      </TimelineImageMetadata>
    </QueryClientProvider>,
  );
  for (const [index, alt] of ["Earlier", "Later"].entries()) {
    const image = view.getByAltText(alt);
    act(() =>
      intersect(
        [
          {
            target: image,
            isIntersecting: true,
            intersectionRatio: 1,
            time: 0,
            boundingClientRect: image.getBoundingClientRect(),
            intersectionRect: image.getBoundingClientRect(),
            rootBounds: null,
          },
        ],
        {} as IntersectionObserver,
      ),
    );
    await waitFor(() =>
      expect(image.getAttribute("src")).toBe(`blob:revision-${index + 1}`),
    );
    Object.defineProperties(image, {
      complete: { value: true },
      naturalWidth: { value: 600 },
      naturalHeight: { value: 375 },
    });
    fireEvent.load(image);
    await waitFor(() => expect(acknowledgements).toHaveLength(index + 1));
    await act(async () => acknowledgements[index]?.());
    await waitFor(() =>
      expect(view.getByTestId("saved").textContent).toBe(
        `"revision-${index + 1}"|`,
      ),
    );
  }
  expect(sdk.threads.saveImageMetadata).toHaveBeenCalledTimes(2);
  act(() =>
    queryClient.setQueryData(
      key,
      makeThreadTimelineResponse({
        imageMetadata: [
          { source, width: 600, height: 375, etag: '"revision-2"' },
          { source: other, width: 100, height: 100, etag: null },
        ],
      }),
    ),
  );
  await waitFor(() =>
    expect(view.getByTestId("saved").textContent).toBe('"revision-2"|100'),
  );
  expect(sdk.threads.saveImageMetadata).toHaveBeenCalledTimes(2);
  expect(queryClient.getQueryData(key)).toMatchObject({
    imageMetadata: expect.arrayContaining([
      { source, width: 600, height: 375, etag: '"revision-2"' },
    ]),
  });
});
