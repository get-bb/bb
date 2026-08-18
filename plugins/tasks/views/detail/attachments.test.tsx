// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../../shared/contract.js";
import { AttachmentsGrid } from "./attachments.js";

afterEach(() => {
  cleanup();
});

function imageAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "01JIMAGE0000000000000000AA",
    taskId: "01JTASK00000000000000000AA",
    commentId: null,
    fileName: "diagram.png",
    mime: "image/png",
    sizeBytes: 1024,
    isImage: true,
    createdAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("AttachmentsGrid layout", () => {
  it("groups file cards before image previews regardless of input order", () => {
    const screen = render(
      <AttachmentsGrid
        attachments={[
          imageAttachment({ id: "01JIMAGE0000000000000000A1" }),
          imageAttachment({
            id: "01JFILE00000000000000000A1",
            fileName: "notes.md",
            mime: "text/markdown",
            isImage: false,
          }),
          imageAttachment({ id: "01JIMAGE0000000000000000A2" }),
        ]}
      />,
    );
    const fileCard = screen.getByText("notes.md");
    const image = screen.getAllByAltText("diagram.png")[0]!;
    expect(
      fileCard.compareDocumentPosition(image) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("AttachmentsGrid removal", () => {
  it("calls the typed removal callback after confirmation", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const attachment = imageAttachment();

    const screen = render(
      <AttachmentsGrid
        attachments={[attachment]}
        onRemove={onRemove}
        onError={onError}
      />,
    );

    fireEvent.click(screen.getByLabelText("Remove diagram.png"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(attachment));
    expect(onError).not.toHaveBeenCalled();
  });

  it("surfaces the server error and does not report a removal on failure", async () => {
    const onRemove = vi.fn().mockRejectedValue(new Error("blob is busy"));
    const onError = vi.fn();

    const screen = render(
      <AttachmentsGrid
        attachments={[imageAttachment()]}
        onRemove={onRemove}
        onError={onError}
      />,
    );

    fireEvent.click(screen.getByLabelText("Remove diagram.png"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("blob is busy"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("shows no remove affordance without an onRemove handler", () => {
    const screen = render(
      <AttachmentsGrid attachments={[imageAttachment()]} />,
    );
    expect(screen.queryByLabelText("Remove diagram.png")).toBeNull();
  });
});
