import { BbHttpError } from "@bb/sdk/browser";
import { describe, expect, it } from "vitest";
import {
  buildEnvironmentFilePreview,
  buildEnvironmentFilePreviewQuery,
  loadFilePreview,
} from "./file-preview-fetch";

function fakeFetch(response: {
  status: number;
  body: string;
  contentType?: string;
}): typeof fetch {
  return async () =>
    new Response(response.body, {
      status: response.status,
      headers: response.contentType
        ? { "content-type": response.contentType }
        : {},
    });
}

describe("loadFilePreview", () => {
  it("classifies text bytes by the content-type header", async () => {
    const preview = await loadFilePreview({
      fetch: fakeFetch({
        status: 200,
        body: "hello",
        contentType: "text/plain; charset=utf-8",
      }),
      path: "a.txt",
      url: "https://s/x",
    });
    expect(preview).toMatchObject({
      kind: "text",
      content: "hello",
      mimeType: "text/plain",
    });
  });

  it("surfaces the server's error code on 413 (file_too_large) and 404", async () => {
    await expect(
      loadFilePreview({
        fetch: fakeFetch({
          status: 413,
          body: JSON.stringify({ code: "file_too_large", message: "too big" }),
          contentType: "application/json",
        }),
        path: "big.bin",
        url: "https://s/x",
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof BbHttpError &&
        error.status === 413 &&
        error.code === "file_too_large",
    );
    await expect(
      loadFilePreview({
        fetch: fakeFetch({ status: 404, body: "" }),
        path: "missing",
        url: "https://s/x",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof BbHttpError && error.status === 404,
    );
  });
});

describe("buildEnvironmentFilePreview", () => {
  it("keeps text inline with the JSON route as its url", () => {
    const preview = buildEnvironmentFilePreview({
      contentUrl: "https://s/diff/file?x",
      path: "src/a.ts",
      response: {
        path: "src/a.ts",
        content: "const a = 1;",
        contentEncoding: "utf8",
        mimeType: "text/typescript",
        sizeBytes: 12,
      },
    });
    expect(preview).toMatchObject({
      kind: "text",
      content: "const a = 1;",
      url: "https://s/diff/file?x",
    });
  });

  it("turns base64 images into a data: URL", () => {
    const preview = buildEnvironmentFilePreview({
      contentUrl: "https://s/diff/file?x",
      path: "a.png",
      response: {
        path: "a.png",
        content: "iVBORw0KGgo=",
        contentEncoding: "base64",
        mimeType: "image/png",
        sizeBytes: 8,
      },
    });
    expect(preview).toMatchObject({
      kind: "image",
      url: "data:image/png;base64,iVBORw0KGgo=",
    });
  });

  it("builds the /diff/file query per source", () => {
    expect(
      buildEnvironmentFilePreviewQuery("a", { kind: "working-tree" }),
    ).toEqual({
      target: "uncommitted",
      path: "a",
      side: "new",
    });
    expect(buildEnvironmentFilePreviewQuery("a", { kind: "head" })).toEqual({
      target: "uncommitted",
      path: "a",
      side: "old",
    });
    expect(
      buildEnvironmentFilePreviewQuery("a", { kind: "merge-base", ref: "abc" }),
    ).toEqual({
      target: "branch_committed",
      mergeBaseRef: "abc",
      path: "a",
      side: "old",
    });
  });
});
