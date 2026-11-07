import { beforeEach, expect, it, vi } from "vitest";

const { open } = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("react-native", () => ({ Linking: { openURL: open } }));
import { openApplicationUrl } from "./application-url";

beforeEach(() => open.mockReset().mockResolvedValue(undefined));

it("validates at the native boundary and passes the original URL to the OS", async () => {
  await expect(openApplicationUrl("javascript:alert(1)")).rejects.toThrow(
    "blocked or invalid",
  );
  await expect(openApplicationUrl("file:///tmp/example")).rejects.toThrow(
    "blocked or invalid",
  );
  expect(open).not.toHaveBeenCalled();
  await openApplicationUrl("reflect://note/Project%20X");
  expect(open).toHaveBeenCalledExactlyOnceWith("reflect://note/Project%20X");
});

it("reports launch failures and permits a later attempt", async () => {
  open.mockRejectedValueOnce(new Error("App not installed"));
  await expect(openApplicationUrl("linear://issue/1")).rejects.toThrow(
    "App not installed",
  );
  await openApplicationUrl("linear://issue/2");
  expect(open).toHaveBeenLastCalledWith("linear://issue/2");
});
