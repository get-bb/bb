// bb-fork(windows): shell enumeration for the Start terminal picker.
import { z } from "zod";
import { terminalShellOptionsSchema } from "@bb/domain";

export const terminalShellListResponseSchema = z
  .object({ shells: terminalShellOptionsSchema })
  .strict();
export type TerminalShellListResponse = z.infer<
  typeof terminalShellListResponseSchema
>;
