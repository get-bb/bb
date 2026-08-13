import { z } from "zod";

const identifier = z.string().trim().min(1).max(512);
const relativeFirmwarePath = z.string().trim().min(1).max(4_096).refine(
  (value) => !value.startsWith("/") && !value.includes("\0") && !value.split("/").some((part) => part === ".."),
  "Firmware paths must be confined relative paths",
);

export const verificationActionSchema = z.object({
  requirement: identifier,
  tier: z.enum(["static", "emulation", "hil", "manual", "hardware"]).optional(),
  check: identifier.optional(),
}).strict();

export const benchActionSchema = z.object({
  pvId: identifier,
  tier: z.enum(["tier0", "tier1"]),
  requirement: identifier.optional(),
  target: z.string().trim().min(1).max(1_000).optional(),
}).strict();

export const firmwareActionSchema = z.object({
  pvId: identifier,
  scanId: identifier.optional(),
  mode: z.enum(["manifest", "hydrate", "hydrate_all"]),
  paths: z.array(relativeFirmwarePath).min(1).max(100).optional(),
}).strict().superRefine((input, issue) => {
  if (input.mode === "hydrate" && input.paths === undefined) {
    issue.addIssue({ code: "custom", path: ["paths"], message: "hydrate requires explicit paths" });
  }
  if (input.mode !== "hydrate" && input.paths !== undefined) {
    issue.addIssue({ code: "custom", path: ["paths"], message: `${input.mode} does not accept paths` });
  }
});
