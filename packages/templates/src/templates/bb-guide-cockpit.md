---
kind: instruction
title: bb Guide — Cockpit
summary: Command reference for the authenticated cockpit-control contract shared by API, CLI, and MCP.
intent: Document discover and act so agents and clients use one owner reference and one typed receipt.
editingNotes: Keep flags accurate against the CLI implementation. Run the json-flag-enforcement and command-output tests after changes.
---
Cockpit commands

The cockpit-control contract discovers agents, sessions, attention items, and
owner-supported actions, then executes one action against an opaque owner
reference. API, CLI, and MCP delegate to the same BB behavior owner and return
the same typed receipt. Browser and tablet clients hold no private machine
credentials; pass the execution host from discovery.

Every command supports --json for machine-readable output except `bb cockpit mcp`,
which speaks MCP stdio.

Discovery:

  bb cockpit discover [--host <id>] [--json]

    --host <id>   Limit discovery to one execution host
    --json        Print the typed discovery document

  The response lists agents, sessions, and attention items. Each item carries
  an opaque ownerRef and the actions that owner currently supports: steer,
  pause, resume, take_over, answer, approve, deny. MFA, passkeys, device
  approval, and legal attestation stay human gates and are rejected.

Action:

  bb cockpit act --owner-ref <ref> --action <kind> --idempotency-key <key> --host <id> [options]

    --owner-ref <ref>          Opaque owner reference from discover
    --action <kind>            steer, pause, resume, take_over, answer, approve, deny
    --idempotency-key <key>    Replay returns the original receipt without repeating the effect
    --host <id>                Execution host selected by authenticated transport
    --message <text>           Required for steer
    --answers-json <json>      Required for answer
    --yes                      Confirm take_over
    --json                     Print the typed receipt

  Unsupported, expired, unauthorized, and wrong-host actions fail closed with
  an actionable error on the receipt. Replaying the same idempotency key
  returns the original receipt.

MCP:

  bb cockpit mcp

    Serves cockpit_discover and cockpit_act over MCP stdio. Tool arguments use
    the same JSON contract as the HTTP API.
