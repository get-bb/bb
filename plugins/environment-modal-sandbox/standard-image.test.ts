import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { readStandardImage, ensureStandardImage } from "./standard-image.js";

const vendor = vi.hoisted(() => ({
  options: vi.fn(),
  lookup: vi.fn(),
  app: vi.fn(),
  registry: vi.fn(),
  commands: vi.fn(),
  build: vi.fn(),
  publish: vi.fn(),
  close: vi.fn(),
}));
vi.mock("modal", () => ({
  NotFoundError: class extends Error {},
  ModalClient: class {
    constructor(options: unknown) {
      vendor.options(options);
    }
    apps = { fromName: vendor.app };
    images = { fromName: vendor.lookup, fromRegistry: vendor.registry };
    close = vendor.close;
  },
}));
import { NotFoundError, type ModalClient } from "modal";
const credentials = { tokenId: "test-id", tokenSecret: "test-secret" };
const request = () => ({
  appName: "test-app",
  displayName: "Image 2",
  dockerfile: readFileSync(new URL("./Dockerfile", import.meta.url), "utf8"),
  signal: new AbortController().signal,
  report: { step: vi.fn(), log: vi.fn() },
});

beforeEach(() => {
  vi.clearAllMocks();
  vendor.lookup.mockReset().mockRejectedValue(new NotFoundError("missing"));
  vendor.app.mockResolvedValue({ appId: "app-1" });
  vendor.registry.mockReturnValue({ dockerfileCommands: vendor.commands });
  vendor.commands.mockReturnValue({ build: vendor.build });
  vendor.build
    .mockReset()
    .mockResolvedValue({ imageId: "im-standard", publish: vendor.publish });
  vendor.publish.mockResolvedValue(undefined);
});

it("builds and publishes the bundled tools image without daemon or credentials", async () => {
  const definition = await readStandardImage();
  expect(definition.reference).toMatch(
    /^node:22\.19\.0-bookworm-slim@sha256:[a-f0-9]{64}$/,
  );
  expect(definition.commands).toContain("USER node");
  expect(definition.commands.join("\n")).toContain(
    "@earendil-works/pi-coding-agent@0.84.0",
  );
  expect(definition.commands.join("\n")).toContain("@openai/codex@");
  expect(definition.commands.join("\n")).toContain(
    "@anthropic-ai/claude-code@",
  );
  expect(definition.commands.join("\n")).not.toMatch(
    /bb-app|machine enroll|daemon|token|secret|COPY/i,
  );
  expect(await ensureStandardImage(credentials, request())).toBe("im-standard");
  expect(vendor.registry).toHaveBeenCalledWith(definition.reference);
  expect(vendor.commands).toHaveBeenCalledWith(definition.commands);
  expect(vendor.publish).toHaveBeenCalledWith(definition.name);
  expect(vendor.close).toHaveBeenCalledOnce();
});

it("reuses the named image without starting another build", async () => {
  vendor.lookup.mockResolvedValue({ imageId: "im-existing" });
  const input = request();
  expect(await ensureStandardImage(credentials, input)).toBe("im-existing");
  expect(input.report.log).toHaveBeenCalledWith(
    "Reusing the Image 2 Modal image",
  );
  expect(vendor.build).not.toHaveBeenCalled();
  expect(vendor.app).not.toHaveBeenCalled();
});

it("does not interpret account failures as a missing image", async () => {
  vendor.lookup.mockRejectedValue(new Error("permission denied"));
  await expect(ensureStandardImage(credentials, request())).rejects.toThrow(
    "permission denied",
  );
  expect(vendor.build).not.toHaveBeenCalled();
  expect(vendor.close).toHaveBeenCalledOnce();
});

it("reports a failed build and permits the next launch to retry", async () => {
  vendor.build.mockRejectedValueOnce(new Error("build failed"));
  await expect(ensureStandardImage(credentials, request())).rejects.toThrow(
    "build failed",
  );
  expect(vendor.publish).not.toHaveBeenCalled();
  expect(await ensureStandardImage(credentials, request())).toBe("im-standard");
  expect(vendor.build).toHaveBeenCalledTimes(2);
});

it("does not start cancelled builds and saves a completed shared image when cancellation arrives during a build", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await expect(
    ensureStandardImage(credentials, {
      ...request(),
      signal: controller.signal,
    }),
  ).rejects.toThrow("cancelled");
  expect(vendor.lookup).not.toHaveBeenCalled();
  const duringBuild = new AbortController();
  vendor.build.mockImplementationOnce(async () => {
    duringBuild.abort(new Error("cancelled"));
    return { imageId: "im-standard", publish: vendor.publish };
  });
  await expect(
    ensureStandardImage(credentials, {
      ...request(),
      signal: duringBuild.signal,
    }),
  ).rejects.toThrow("cancelled");
  expect(vendor.publish).toHaveBeenCalledOnce();
  expect(vendor.close).toHaveBeenCalledOnce();
});

it("captures build output without swallowing unary API responses", async () => {
  const input = request();
  await ensureStandardImage(credentials, input);
  const options: NonNullable<ConstructorParameters<typeof ModalClient>[0]> =
    vendor.options.mock.calls[0]![0];
  const middleware = options.grpcMiddleware![0]!;
  const unary = middleware(
    {
      method: {
        path: "/modal.client.ModalClient/AppGetOrCreate",
        requestStream: false,
        responseStream: false,
        options: {},
      },
      requestStream: false,
      responseStream: false,
      request: {},
      next: async function* () {
        return { appId: "app-1" };
      },
    },
    {},
  );
  expect(await unary.next()).toEqual({ done: true, value: { appId: "app-1" } });
  const output = { taskLogs: [{ data: "RUN diagnostic\n" }] };
  const stream = middleware(
    {
      method: {
        path: "/modal.client.ModalClient/ImageJoinStreaming",
        requestStream: false,
        responseStream: true,
        options: {},
      },
      requestStream: false,
      responseStream: true,
      request: {},
      next: async function* () {
        yield output;
      },
    },
    {},
  );
  expect(await stream.next()).toEqual({ done: false, value: output });
  expect(input.report.log).toHaveBeenCalledWith("RUN diagnostic\n");
  expect(await stream.next()).toEqual({ done: true, value: undefined });
});
