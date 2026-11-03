import { describe, expect, it, vi } from "vitest";
import { PROMPT_ATTACHMENT_MAX_BYTES } from "@bb/domain";
import { BbHttpError, createBrowserBbSdk } from "@bb/sdk/browser";
import {
  PromptAttachmentSizeError,
  uploadWithinPromptAttachmentLimit,
} from "./prompt-attachment-size";

const CLOUDFLARE_413_HTML =
  "<html>\r\n<head><title>413 Payload Too Large</title></head>\r\n<body>\r\n<center><h1>413 Payload Too Large</h1></center>\r\n<hr><center>cloudflare</center>\r\n</body>\r\n</html>\r\n";

const uploaded = {
  type: "localFile",
  path: "attachments/clip.mp4",
  name: "clip.mp4",
  sizeBytes: 4,
};

function uploadThrough(file: File, respond: () => Response) {
  const fetch = vi.fn(async () => respond());
  const sdk = createBrowserBbSdk({ baseUrl: "http://bb.test", fetch });
  const result = uploadWithinPromptAttachmentLimit(file, () =>
    sdk.projects.attachments.upload({ projectId: "proj_1", clientFile: file }),
  );
  return { fetch, result };
}

function sizedFile(name: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type: "video/mp4" });
}

describe("uploadWithinPromptAttachmentLimit", () => {
  it("rejects a file over the limit without sending it", async () => {
    const { fetch, result } = uploadThrough(
      sizedFile("VID_0001.mp4", PROMPT_ATTACHMENT_MAX_BYTES + 1),
      () => Response.json(uploaded),
    );

    await expect(result).rejects.toThrow(
      new PromptAttachmentSizeError(
        "VID_0001.mp4 is 35.1MB, over the 35MB attachment limit",
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a file exactly at the limit", async () => {
    const { fetch, result } = uploadThrough(
      sizedFile("clip.mp4", PROMPT_ATTACHMENT_MAX_BYTES),
      () => Response.json(uploaded),
    );

    await expect(result).resolves.toEqual(uploaded);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("explains a proxy's HTML 413 instead of reporting the bare status", async () => {
    const { result } = uploadThrough(
      sizedFile("clip.mp4", 3 * 1024 * 1024),
      () =>
        new Response(CLOUDFLARE_413_HTML, {
          status: 413,
          headers: { "content-type": "text/html; charset=UTF-8" },
        }),
    );

    await expect(result).rejects.toThrow(
      new PromptAttachmentSizeError(
        "clip.mp4 (3MB) is too large to upload over this connection",
      ),
    );
  });

  it.each([
    [400, "HEIC images are not supported."],
    [413, "Request body exceeds the server limit"],
  ])("keeps the bb server's own %s reason", async (status, message) => {
    const { result } = uploadThrough(sizedFile("clip.mp4", 4), () =>
      Response.json({ code: "invalid_request", message }, { status }),
    );

    const error = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BbHttpError);
    expect(error).toMatchObject({ status, body: { message } });
  });
});
