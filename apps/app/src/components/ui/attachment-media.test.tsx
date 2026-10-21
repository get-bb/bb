// @vitest-environment jsdom

import { Suspense, useState } from "react";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VideoThumbnail } from "@bb/shared-ui/video-thumbnail";
import { AttachmentPreview } from "../promptbox/AttachmentPreview";
import {
  clearLocalAttachmentPreviews,
  registerLocalAttachmentPreview,
} from "@/lib/attachment-local-previews";
import {
  buildAttachmentItems,
  ConversationAttachments,
} from "../thread/timeline/ConversationAttachments";

const videoPath = "uploads/Screen Recording.MOV";

function Composer() {
  const [index, setIndex] = useState<number | null>(null);
  return (
    <AttachmentPreview
      attachments={[
        { type: "localImage", path: "uploads/image.png", name: "Image" },
        { type: "localFile", path: videoPath, name: "Recording" },
      ]}
      attachmentProjectId="project"
      expandedImageIndex={index}
      onExpandedImageIndexChange={setIndex}
    />
  );
}

function Conversation() {
  return (
    <ConversationAttachments
      {...buildAttachmentItems({
        attachments: {
          webImages: 0,
          localImages: 1,
          localFiles: 1,
          imageUrls: [],
          localImagePaths: ["uploads/image.png"],
          localFilePaths: [videoPath],
          localFileDetails: [
            { path: videoPath, name: "Recording", sizeBytes: 1024 },
          ],
        },
        projectId: "project",
      })}
    />
  );
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  clearLocalAttachmentPreviews();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["video/quicktime", ""])(
  "reuses an uploaded video locally for its thumbnail and lightbox (MIME %s)",
  (type) => {
    const createObjectURL = vi.fn(() => "blob:local-video");
    const revokeObjectURL = vi.fn();
    class PreviewURL extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal("URL", PreviewURL);
    const file = new File(["video"], "Screen Recording.MOV", { type });
    registerLocalAttachmentPreview(videoPath, file);
    const view = render(<Composer />);
    const trigger = view.getByRole("button", { name: "Recording" });
    expect(trigger.querySelector("video")?.getAttribute("src")).toBe(
      "blob:local-video#t=0.001",
    );
    fireEvent.click(trigger);
    expect(
      view.getByRole("dialog").querySelector("video")?.getAttribute("src"),
    ).toBe("blob:local-video");
    expect(createObjectURL).toHaveBeenCalledWith(file);
    view.unmount();
    clearLocalAttachmentPreviews();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:local-video");
  },
);

it.each([
  { name: "composer", Surface: Composer },
  { name: "conversation", Surface: Conversation },
])(
  "opens video attachments and preserves playback keyboard controls in $name",
  ({ Surface }) => {
    const view = render(<Surface />);
    const trigger = view.getByRole("button", { name: "Recording" });
    expect(trigger.querySelector("video")).not.toBeNull();
    fireEvent.click(trigger);
    const dialog = view.getByRole("dialog");
    const video = within(dialog).getByLabelText<HTMLVideoElement>("Recording");
    expect(video.controls).toBe(true);
    expect(new URL(video.src).searchParams.get("path")).toBe(videoPath);
    fireEvent.click(video);
    expect(view.getByRole("dialog")).toBe(dialog);
    fireEvent.keyDown(video, { key: "ArrowLeft" });
    expect(within(dialog).getByLabelText("Recording")).toBe(video);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Previous image" }),
    );
    expect(dialog.querySelector("video")).toBeNull();
    expect(dialog.querySelector("img")).not.toBeNull();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(within(dialog).getByLabelText("Recording")).not.toBeNull();
    fireEvent.keyDown(within(dialog).getByLabelText("Recording"), {
      key: "Escape",
    });
    expect(view.queryByRole("dialog")).toBeNull();
  },
);

it("does not load videos from abandoned renders and releases mounted video sources", () => {
  const pending = new Promise<void>(() => {});
  function Suspend({ blocked }: { blocked: boolean }) {
    if (blocked) throw pending;
    return null;
  }
  const createElement = vi.spyOn(document, "createElement");
  const load = vi
    .spyOn(HTMLMediaElement.prototype, "load")
    .mockImplementation(() => {});
  const content = (blocked: boolean) => (
    <Suspense fallback={<span>Loading composer</span>}>
      <VideoThumbnail src="/recording.mp4" />
      <Suspend blocked={blocked} />
    </Suspense>
  );
  const view = render(content(true));
  const speculativeVideos = createElement.mock.results.flatMap((result) =>
    result.type === "return" && result.value instanceof HTMLVideoElement
      ? [result.value]
      : [],
  );
  expect(speculativeVideos.length).toBeGreaterThan(0);
  for (const video of speculativeVideos)
    expect(video.getAttribute("src")).toBeNull();
  view.rerender(content(false));
  const mounted = view.container.querySelector("video")!;
  expect(mounted.getAttribute("src")).toBe("/recording.mp4#t=0.001");
  view.unmount();
  expect(mounted.getAttribute("src")).toBeNull();
  expect(load).toHaveBeenCalled();
});
