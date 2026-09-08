import { definePluginApp } from "@get-bb/plugin-sdk/app";

export function ManualMachineInputs() {
  return (
    <details className="max-w-sm text-sm text-muted-foreground">
      <summary className="cursor-pointer">Enrollment instructions</summary>
      <div className="mt-2 space-y-2">
        <p>
          Run the enrollment command on an existing machine; bb is installed if
          needed. Keep this window open while it connects.
        </p>
        <p>
          Removing this machine revokes its access. Uninstall bb on the machine
          manually with{" "}
          <code>bb machine uninstall --host-id &lt;host-id&gt;</code>.
        </p>
      </div>
    </details>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_machineProviderInputs({
    machineProviderId: "manual",
    component: ManualMachineInputs,
  });
});
