import { expect, it } from "vitest";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";

it.each([
  ["photo.HEIC", "", undefined, "image/heic"],
  ["photo.heif", "", undefined, "image/heif"],
  [
    "photo.heic",
    "application/octet-stream",
    undefined,
    "application/octet-stream",
  ],
  [
    "photo.heic",
    "image/heic",
    "application/octet-stream",
    "application/octet-stream",
  ],
  ["notes.txt", "", undefined, "application/octet-stream"],
])(
  "preserves attachment MIME intent for %s (%s, %s)",
  async (name, fileType, override, expectedType) => {
    let received: File | undefined;
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "browser",
        fetch: async (input, init) => {
          const file = (await new Request(input, init).formData()).get("file");
          if (!(file instanceof File)) throw new Error("Expected file");
          received = file;
          return Response.json(
            {
              type: "localFile",
              path: "stored",
              name,
              mimeType: file.type,
              sizeBytes: file.size,
            },
            { status: 201 },
          );
        },
      }),
    });
    await sdk.projects.attachments.upload({
      projectId: "proj_image",
      clientFile: new File(["bytes"], name, { type: fileType }),
      ...(override === undefined ? {} : { mimeType: override }),
    });
    expect(received?.type).toBe(expectedType);
    expect(await received?.text()).toBe("bytes");
  },
);
