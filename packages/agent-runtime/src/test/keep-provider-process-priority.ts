import { vi } from "vitest";

vi.mock("@bb/process-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bb/process-utils")>()),
  deprioritizeAgentWorkload: () => undefined,
}));
