# Cockpit-control

Use `bb cockpit` when a client needs one authenticated control contract for
agents, sessions, and attention items instead of calling thread APIs directly.

```sh
bb cockpit discover --json
bb cockpit act --owner-ref "$OWNER_REF" --action pause --idempotency-key pause-1 --host "$HOST_ID" --json
```

Discovery returns opaque owner references and the actions each owner currently
supports. Pass those references back to `act`. Do not construct owner
references. The execution host comes from discovery; clients do not hold
private machine credentials.

`steer`, `pause`, `resume`, `take_over`, `answer`, `approve`, and `deny` run
when the owner reports them. MFA, passkeys, device approval, and legal
attestation remain human gates and fail closed.

Replaying an idempotency key returns the original typed receipt without
repeating the effect. Unsupported, expired, unauthorized, and wrong-host
actions fail closed with an actionable error on the receipt.

The SDK equivalents are `sdk.cockpit.discover` and `sdk.cockpit.act`.
`bb cockpit mcp` serves the same two tools over MCP stdio.
