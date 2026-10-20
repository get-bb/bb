import { afterEach, expect, it, vi } from "vitest";
import {
  createPendingAttachmentUploads,
  finishPendingAttachmentUploads,
  readPendingAttachmentUploads,
  startPendingAttachmentUploads,
} from "./usePendingAttachmentUploads";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("gives same-named previews distinct ids without the secure-context randomUUID API", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });
  const file = new File(["image"], "same-name.png", { type: "image/png" });

  const uploads = createPendingAttachmentUploads([file, file, file]);

  expect(new Set(uploads.map((upload) => upload.id)).size).toBe(3);
});

it("keeps a draft's in-flight uploads visible to a composer that mounts later, and only for that draft", () => {
  const first = new File(["a"], "a.mov");
  const second = new File(["b"], "b.png");
  const started = startPendingAttachmentUploads("draft-a", [first]);
  const more = startPendingAttachmentUploads("draft-a", [second]);

  expect(
    readPendingAttachmentUploads("draft-a").map((upload) => upload.file),
  ).toEqual([first, second]);
  expect(readPendingAttachmentUploads("draft-b")).toEqual([]);

  finishPendingAttachmentUploads(started);
  expect(
    readPendingAttachmentUploads("draft-a").map((upload) => upload.file),
  ).toEqual([second]);

  finishPendingAttachmentUploads(more);
  expect(readPendingAttachmentUploads("draft-a")).toEqual([]);
});
