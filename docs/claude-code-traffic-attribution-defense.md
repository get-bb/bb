# Claude Code Traffic Attribution Defense

## Context

PR #84 changes bb's Claude Code Agent SDK sessions to use the closest supported
Claude CLI identity. Setting `CLAUDE_CODE_ENTRYPOINT=cli` makes the spawned
Claude binary report `sdk-cli` on the wire, and clearing
`CLAUDE_AGENT_SDK_CLIENT_APP` removes bb's `client-app/...` user-agent segment.

That matches headless `claude -p` traffic. It does not match the interactive
Claude Code CLI, because the Claude binary deliberately prefixes stream-json SDK
sessions with `sdk-` and the Agent SDK injects its own user-agent segment.

## Threat Model

A local process can sit between the Claude binary and the API endpoint and
rewrite mutable request fields, including:

- `user-agent`
- `x-anthropic-billing-header`
- request body metadata that repeats the client entrypoint

If the API trusts only those client-supplied fields, a rewriting proxy can make
SDK-originated traffic look like interactive CLI traffic. Once all mutable
identity fields are rewritten, the request body shape observed in the handoff is
not enough to reliably distinguish interactive CLI from SDK-driven Claude Code:
both use the same `/v1/messages?beta=true` SSE endpoint, system prompt preset,
tool set, context management, thinking configuration, cache controls, and OAuth
account identity.

## Defensive Implications

Do not make authorization, billing, or entitlement decisions solely from mutable
HTTP headers or body metadata.

Prefer server-verifiable attribution:

- Bind the allowed client mode to the OAuth client, grant, or token metadata and
  compare it with the claimed entrypoint on every request.
- Treat `user-agent` and `x-anthropic-billing-header` as telemetry unless they
  are covered by an integrity mechanism the local proxy cannot recompute.
- Have the official CLI obtain a short-lived, server-issued session assertion
  that includes the client mode, binary channel, account, and expiration. The API
  should validate that assertion independently of the HTTP headers.
- If a client assertion is added, include a nonce or request hash so replaying a
  captured assertion through a proxy is not sufficient.
- Log mismatches between claimed entrypoint, OAuth client metadata, SDK-specific
  fields, and known CLI release channels as detection signals.

## Local Reproduction Guidance

Use a mock or self-hosted endpoint for tests that need to model header/body
rewriting. A safe test fixture should:

- Refuse upstream hosts outside loopback addresses except for explicitly
  approved non-production security test hosts such as `api.anthropic.com`.
- Rewrite only local test traffic.
- Assert that the detector or entitlement layer ignores mutable claims and uses
  server-verifiable identity instead.

Do not add a production-capable proxy to bb. The production runtime should stay
at the supported `sdk-cli` parity from PR #84 unless Anthropic exposes an
official attribution mechanism for this use case.
