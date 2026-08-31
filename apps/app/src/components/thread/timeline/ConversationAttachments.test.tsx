// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppNavigationHostProvider } from "@/lib/app-navigation-host";
import {
  ConversationAttachments,
  buildAttachmentItems,
} from "./ConversationAttachments";

afterEach(cleanup);

describe("conversation attachment contract", () => {
  it("classifies project attachments and absolute host files without ambiguity", () => {
    const items = buildAttachmentItems({
      attachments: {
        webImages: 0,
        localImages: 2,
        localFiles: 2,
        imageUrls: [],
        localImagePaths: ["/workspace/图 100%.png", "stored/image.png"],
        localFilePaths: [
          "/workspace/report 100%.pdf",
          "stored/report 100%.pdf",
        ],
      },
      projectId: "proj_1",
      threadId: "thr_1",
    });

    expect(items.fileItems.map((item) => item.identity?.source)).toEqual([
      {
        store: "thread-host",
        ownerId: "thr_1",
        path: "/workspace/report 100%.pdf",
      },
      {
        store: "project-attachment",
        ownerId: "proj_1",
        path: "stored/report 100%.pdf",
      },
    ]);
    expect(items.imageItems[0]?.src).toContain(
      "/threads/thr_1/host-files/preview?",
    );
    expect(items.imageItems[1]?.src).toContain(
      "/projects/proj_1/attachments/preview?",
    );
    expect(items.imageItems.every((item) => item.downloadUrl !== null)).toBe(
      true,
    );
  });

  it("renders active Open and Download controls in the shared web renderer", () => {
    const openFilePreview = vi.fn(() => true);
    const items = buildAttachmentItems({
      attachments: {
        webImages: 0,
        localImages: 0,
        localFiles: 1,
        imageUrls: [],
        localImagePaths: [],
        localFilePaths: ["stored/资料 100%.pdf"],
      },
      projectId: "proj_1",
      threadId: "thr_1",
    });
    render(
      <AppNavigationHostProvider capabilities={{ openFilePreview }}>
        <ConversationAttachments {...items} />
      </AppNavigationHostProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open 资料 100%.pdf" }));
    expect(openFilePreview).toHaveBeenCalledWith({
      identity: expect.objectContaining({
        source: expect.objectContaining({ store: "project-attachment" }),
      }),
    });
    const download = screen.getByRole("link", {
      name: "Download 资料 100%.pdf",
    });
    expect(download.getAttribute("href")).toContain("/attachments/download?");
    expect(download.getAttribute("download")).toBe("资料 100%.pdf");
  });

  it("renders Download for byte-backed images", () => {
    const items = buildAttachmentItems({
      attachments: {
        webImages: 0,
        localImages: 1,
        localFiles: 0,
        imageUrls: [],
        localImagePaths: ["stored/diagram.png"],
        localFilePaths: [],
      },
      projectId: "proj_1",
      threadId: "thr_1",
    });
    render(<ConversationAttachments {...items} />);

    const download = screen.getByRole("link", {
      name: "Download diagram.png",
    });
    expect(download.getAttribute("href")).toContain("/attachments/download?");
    expect(download.getAttribute("download")).toBe("diagram.png");
  });

  it("renders malformed URL-like paths as inert controls", () => {
    const items = buildAttachmentItems({
      attachments: {
        webImages: 0,
        localImages: 0,
        localFiles: 1,
        imageUrls: [],
        localImagePaths: [],
        localFilePaths: ["https:"],
      },
      projectId: "proj_1",
      threadId: "thr_1",
    });
    render(<ConversationAttachments {...items} />);

    expect(screen.getByText("https:")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("leaves unresolved controls inert and visible", () => {
    const items = buildAttachmentItems({
      attachments: {
        webImages: 0,
        localImages: 0,
        localFiles: 1,
        imageUrls: [],
        localImagePaths: [],
        localFilePaths: ["relative-without-project.bin"],
      },
    });
    render(<ConversationAttachments {...items} />);

    expect(screen.getByText("relative-without-project.bin")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
