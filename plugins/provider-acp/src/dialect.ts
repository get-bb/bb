/**
 * Per-agent dialects: the vendor side channels of an ACP agent.
 *
 * The ACP wire schema (`wire.ts`) parses only the protocol. What an agent
 * puts beside the protocol — grok's `_meta["x.ai/tool"]`, Cursor's
 * `cursor/task` request — is a dialect: a small, profile-keyed module that
 * reads those channels and answers a few questions the shared translator
 * asks. The shared schema never learns a vendor key; a dialect never changes
 * what the protocol fields mean.
 *
 * The dialect is selected per session from the agent's launch command. An
 * agent with no dialect of its own gets the generic one, which answers
 * nothing and leaves every decision to the protocol fields.
 */

import { basename } from "node:path";
import { z } from "zod";
import {
  acpToolKindSchema,
  type AcpToolCallUpdateEvent,
  type AcpToolKind,
} from "./wire.js";

/**
 * The programmatic identity of a tool call, when the agent reports one
 * outside the protocol's unstable `name` field: the tool's own name and, for
 * an agent that sends the `kind` late (grok puts it on the first update, a
 * few milliseconds after the `tool_call`), the kind at open, so the opened
 * shape and the closed shape agree.
 */
export interface AcpToolIdentity {
  name?: string;
  kind?: AcpToolKind;
}

export interface AcpDialect {
  /** Stable id, for logs and tests. */
  readonly id: string;
  /**
   * The tool identity a tool_call / tool_call_update carries in the agent's
   * side channel, if any. The translator fills an absent protocol `name` and
   * `kind` from it; a protocol value always wins over the dialect's.
   */
  toolIdentity?(event: AcpToolCallUpdateEvent): AcpToolIdentity | undefined;
}

/** The dialect of an agent with no side channels bb reads. */
export const GENERIC_ACP_DIALECT: AcpDialect = { id: "acp" };

// ---------------------------------------------------------------------------
// grok (`grok agent stdio`)
// ---------------------------------------------------------------------------

/**
 * grok stamps `_meta["x.ai/tool"]` on every tool event: the tool's
 * programmatic name (`run_terminal_command`, `read_file`), its kind, a label,
 * and a read-only flag. The `tool_call` itself carries no `kind` and the
 * model's tool name as its title; the first `tool_call_update` adds the kind
 * and a human title.
 */
const grokToolMetaSchema = z
  .object({
    "x.ai/tool": z
      .object({
        name: z.string().optional(),
        kind: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

function grokToolIdentity(
  event: AcpToolCallUpdateEvent,
): AcpToolIdentity | undefined {
  const meta = grokToolMetaSchema.safeParse(event["_meta"]);
  if (!meta.success) {
    return undefined;
  }
  const tool = meta.data["x.ai/tool"];
  const kind = acpToolKindSchema.safeParse(tool.kind);
  return {
    ...(tool.name !== undefined && tool.name.length > 0
      ? { name: tool.name }
      : {}),
    ...(kind.success ? { kind: kind.data } : {}),
  };
}

export const GROK_ACP_DIALECT: AcpDialect = {
  id: "grok",
  toolIdentity: grokToolIdentity,
};

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Dialects by the launch command's executable name. */
const DIALECTS_BY_COMMAND: Readonly<Record<string, AcpDialect>> = {
  grok: GROK_ACP_DIALECT,
};

/**
 * The dialect for an agent launch: keyed by the executable's base name
 * (`/usr/local/bin/grok` and `grok` both select the grok dialect), generic
 * for everything else.
 */
export function resolveAcpDialect(launch: { command: string }): AcpDialect {
  const executable = basename(launch.command);
  return DIALECTS_BY_COMMAND[executable] ?? GENERIC_ACP_DIALECT;
}
