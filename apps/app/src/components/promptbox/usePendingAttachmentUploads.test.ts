import { afterEach, expect, it, vi } from "vitest";
import { createPendingAttachmentUploads } from "./usePendingAttachmentUploads";

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
