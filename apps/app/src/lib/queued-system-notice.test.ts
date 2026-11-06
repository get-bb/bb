import { makeThreadQueuedMessage } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  isTransientSystemNotice,
  visibleQueuedMessages,
} from "@/lib/queued-system-notice";

const notice = { kind: "child-completed" as const, subject: null };

describe("visibleQueuedMessages", () => {
  it("hides bb notices that are still collecting or being delivered", () => {
    const collecting = makeThreadQueuedMessage({
      id: "collecting",
      systemNotice: notice,
      waitingOn: { kind: "time" },
    });
    const delivering = makeThreadQueuedMessage({
      id: "delivering",
      systemNotice: notice,
      waitingOn: null,
    });
    const user = makeThreadQueuedMessage({
      id: "user",
      waitingOn: { kind: "time" },
    });
    expect(
      visibleQueuedMessages([collecting, user, delivering]).map(
        (row) => row.id,
      ),
    ).toEqual(["user"]);
  });

  it("keeps bb notices that are stuck or failed", () => {
    expect(
      isTransientSystemNotice(
        makeThreadQueuedMessage({
          systemNotice: notice,
          waitingOn: { kind: "host-offline", hostName: "M4" },
        }),
      ),
    ).toBe(false);
    expect(
      isTransientSystemNotice(
        makeThreadQueuedMessage({
          systemNotice: notice,
          waitingOn: { kind: "time" },
          failureReason: "Provider rejected the turn",
        }),
      ),
    ).toBe(false);
  });

  it("returns the same list when nothing is hidden", () => {
    const rows = [makeThreadQueuedMessage({ waitingOn: null })];
    expect(visibleQueuedMessages(rows)).toBe(rows);
  });
});
