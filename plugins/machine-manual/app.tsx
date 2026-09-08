import { definePluginApp } from "@get-bb/plugin-sdk/app";

export function ManualMachineInputs() {
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>
        Run the enrollment command on an existing machine ; bb is installed if
        needed. Keep this window open while it connects.
      </p>
      <p>
        Removing this machine revokes its access. Uninstall bb on the machine
        manually with{" "}
        <code>bb machine uninstall --host-id &lt;host-id&gt;</code>.
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_machineProviderInputs({
    machineProviderId: "manual",
    component: ManualMachineInputs,
  });
});
