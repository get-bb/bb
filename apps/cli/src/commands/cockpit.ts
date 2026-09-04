import { Command } from "commander";
import {
  cockpitActionKindSchema,
  cockpitActionRequestSchema,
  cockpitActionSchema,
  type CockpitAction,
  type CockpitActionKind,
  type CockpitConfirmation,
} from "@bb/domain";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { renderBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";
import { runCockpitMcpStdio } from "./cockpit-mcp.js";

interface CockpitDiscoverOptions {
  host?: string;
  json?: boolean;
}

interface CockpitActOptions {
  ownerRef: string;
  action: string;
  idempotencyKey: string;
  host: string;
  message?: string;
  answersJson?: string;
  yes?: boolean;
  json?: boolean;
}

function parseAction(opts: CockpitActOptions): CockpitAction {
  const kind = cockpitActionKindSchema.parse(opts.action);
  switch (kind) {
    case "steer":
      if (opts.message === undefined || opts.message.length === 0) {
        throw new Error("steer requires --message");
      }
      return { kind: "steer", message: opts.message };
    case "answer": {
      if (opts.answersJson === undefined) {
        throw new Error("answer requires --answers-json");
      }
      return cockpitActionSchema.parse({
        kind: "answer",
        answers: JSON.parse(opts.answersJson) as unknown,
      });
    }
    case "pause":
    case "resume":
    case "take_over":
    case "approve":
    case "deny":
    case "mfa":
    case "passkey":
    case "device_approval":
    case "legal_attestation":
      return { kind };
  }
}

function confirmationFor(
  kind: CockpitActionKind,
  yes: boolean,
): CockpitConfirmation {
  if (kind === "take_over") {
    return yes ? "confirmed" : "none";
  }
  return "none";
}

export function registerCockpitCommands(
  program: Command,
  getUrl: () => string,
): void {
  const cockpit = program
    .command("cockpit")
    .description("Authenticated cockpit-control for agents, sessions, and attention");

  cockpit
    .command("discover")
    .description("Discover agents, sessions, attention items, and supported actions")
    .option("--host <id>", "Limit discovery to one execution host")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: CockpitDiscoverOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const discovery = await sdk.cockpit.discover({
          hostId: opts.host ?? null,
        });
        if (outputJson(opts, discovery)) {
          return;
        }
        if (discovery.sessions.length === 0) {
          console.log("No cockpit sessions");
        } else {
          console.log(
            renderBorderlessTable(
              {
                head: ["Session", "Host", "Status", "Actions"],
                colWidths: [28, 16, 10, 28],
              },
              discovery.sessions.map((session) => [
                session.displayName,
                session.hostId,
                session.status,
                session.supportedActions.join(","),
              ]),
            ),
          );
        }
        if (discovery.attentionItems.length > 0) {
          console.log(
            renderBorderlessTable(
              {
                head: ["Attention", "Kind", "Host", "Actions"],
                colWidths: [28, 12, 16, 20],
              },
              discovery.attentionItems.map((item) => [
                item.ownerRef,
                item.attentionKind,
                item.hostId,
                item.supportedActions.join(","),
              ]),
            ),
          );
        }
      }),
    );

  cockpit
    .command("act")
    .description("Execute a cockpit-control action against an opaque owner reference")
    .requiredOption("--owner-ref <ref>", "Opaque owner reference from discover")
    .requiredOption(
      "--action <kind>",
      "steer, pause, resume, take_over, answer, approve, deny",
    )
    .requiredOption("--idempotency-key <key>", "Idempotency key for this action")
    .requiredOption("--host <id>", "Execution host selected by authenticated transport")
    .option("--message <text>", "Steer message")
    .option("--answers-json <json>", "Answer map for a question attention item")
    .option("--yes", "Confirm take_over")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: CockpitActOptions) => {
        const parsedAction = parseAction(opts);
        const request = cockpitActionRequestSchema.parse({
          ownerRef: opts.ownerRef,
          action: parsedAction,
          idempotencyKey: opts.idempotencyKey,
          hostId: opts.host,
          confirmation: confirmationFor(parsedAction.kind, opts.yes === true),
        });
        const sdk = createCliBbSdk(getUrl());
        const receipt = await sdk.cockpit.act(request);
        if (outputJson(opts, receipt)) {
          return;
        }
        if (receipt.outcome === "rejected") {
          throw new Error(
            receipt.error === null
              ? "Cockpit-control action rejected"
              : `${receipt.error.code}: ${receipt.error.message}`,
          );
        }
        console.log(
          `Cockpit ${receipt.action.kind} ${receipt.outcome} (${receipt.receiptId})`,
        );
      }),
    );

  cockpit
    .command("mcp")
    .description("Serve the cockpit-control contract over MCP stdio")
    .action(
      action(async () => {
        await runCockpitMcpStdio(createCliBbSdk(getUrl()));
      }),
    );
}
