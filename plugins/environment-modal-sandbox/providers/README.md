# Sandbox backends

`sandbox-backend.ts` is the plugin-internal extension point for a sandbox
vendor. `register.ts` translates that interface into BB machine and composed
environment registrations. Vendor SDKs and persisted vendor resource schemas
live in a named subdirectory.

```text
providers/
  sandbox-backend.ts
  register.ts
  modal/
    backend.ts
    client.ts
    image.ts
    resource.ts
```

To add another backend:

1. Create `providers/<vendor>/resource.ts` with a runtime parser for that
   vendor's persisted machine resource.
2. Keep direct vendor SDK calls in `providers/<vendor>/client.ts` and any
   adjacent vendor-only modules.
3. Implement `SandboxBackend` in `providers/<vendor>/backend.ts`, including its
   registration definition and input parser.
4. Construct the backend in `server.ts` and pass it to
   `registerSandboxBackend`. Add vendor-specific settings, diagnostics, and UI
   separately when the backend requires them.
5. Use `register.test.ts` as the minimal non-Modal example, add lifecycle tests
   for the implementation, and add focused client tests for vendor API
   translation.

The backend must preserve these lifecycle invariants:

- `create` converges on the durable allocation key and checkpoints an
  allocation before returning its executor.
- `reconcileCleanup` removes uncertain allocations by key without creating or
  bootstrapping anything. Modal lists sandboxes tagged with `bbMachineKey` across
  apps in the credentials' current environment, then terminates and checks each
  sandbox by ID. Changing App Name does not redirect cleanup. Enumeration or
  termination failures remain retryable; credentials must still access the
  original account/environment. No additional persisted allocation state is used.
- `suspend`, `resume`, and `remove` are idempotent.
- `suspend` returns a resource from which `resume` can converge; the mechanism
  remains vendor-specific.
- `resume` checkpoints any new live allocation identity before returning its
  executor.
- Resource and input values are parsed at the boundary.
- `close` releases every cached vendor client.

BB owns daemon bootstrap, lifecycle result translation, cancellation, and the
composed environment registration. The backend owns vendor allocation,
storage semantics, cleanup, and conversion to `MachineExecutor`.
