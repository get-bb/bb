import { appendFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onFlashCompleted, runFlash } from "./flash.js";
import { AuthoringError, runBuild } from "./runner.js";
import {
  confirmationFixture,
  createFixture,
  type AuthoringFixture,
} from "./test-fixture.js";

const fixtures: AuthoringFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

async function fixture(input: Parameters<typeof createFixture>[0] = {}) {
  const value = await createFixture(input);
  fixtures.push(value);
  return value;
}

describe("flash runner", () => {
  it("fails closed before device resolution or subprocess planning without confirmation", async () => {
    const fx = await fixture({ confirmationValid: false });
    const device = vi.spyOn(fx.ctx, "resolveDevice");
    await expect(
      runFlash(fx.ctx, { confirmation: confirmationFixture() }),
    ).rejects.toMatchObject({
      code: "DESTRUCTIVE_CONFIRMATION_REQUIRED",
      hint: expect.stringContaining("current turn"),
    } satisfies Partial<AuthoringError>);
    expect(device).not.toHaveBeenCalled();
    expect(fx.spawned.flash).toBe(0);
  });

  it("flashes an unchanged build digest and emits the completion event", async () => {
    const fx = await fixture({ confirmationValid: true });
    const build = await runBuild(fx.ctx, { target: "board-a" });
    const events: Array<{ runId: string; device: string; digest: string }> = [];
    onFlashCompleted((event) => events.push(event));
    const flash = await runFlash(fx.ctx, {
      runId: build.runId,
      device: "probe-a",
      confirmation: confirmationFixture(),
    });
    expect(flash).toMatchObject({
      kind: "flash",
      status: "succeeded",
      target: "probe-a",
      digest: build.digest,
    });
    expect(events.at(-1)).toEqual({
      runId: flash.runId,
      device: "probe-a",
      digest: build.digest,
    });
  });

  it("refuses when artifact bytes no longer match the immutable build digest", async () => {
    const fx = await fixture({ confirmationValid: true });
    const build = await runBuild(fx.ctx, {});
    await appendFile(`${fx.root}/${build.artifact}`, "changed", "utf8");
    await expect(
      runFlash(fx.ctx, { runId: build.runId, confirmation: confirmationFixture() }),
    ).rejects.toMatchObject({ code: "FLASH_IMAGE_MISMATCH" } satisfies Partial<AuthoringError>);
    expect(fx.spawned.flash).toBe(0);
  });
});
