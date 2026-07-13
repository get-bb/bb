// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { ConversationMessageContent } from "./ConversationMessageContent";

afterEach(cleanup);

describe("ConversationMessageContent assistant images", () => {
  it("serves local Markdown images through the thread host-file route", () => {
    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ConversationMessageContent
            role="assistant"
            attachments={null}
            id="msg_image"
            threadId="thr_image"
            turnId="turn_image"
            sourceSeqStart={1}
            sourceSeqEnd={2}
            showActions={false}
            mobileActionDisplay="overflow"
            text="![Generated diagram](/workspace/output/diagram.png)"
            turnRequest={null}
          />
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    expect(
      screen
        .getByRole("img", { name: "Generated diagram" })
        .getAttribute("src"),
    ).toBe(
      "/api/v1/threads/thr_image/host-files/content?path=%2Fworkspace%2Foutput%2Fdiagram.png",
    );
  });
});
