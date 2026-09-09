import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function manualMachinePlugin(bb: BbPluginApi): void {
  bb.experimental_machines.register({
    id: "manual",
    displayName: "Manual machine setup",
    icon: "Terminal",

    async create(context) {
      context.signal.throwIfAborted();
      const enrollment = await bb.experimental_machines.enrollments.prepare({
        key: context.key,
      });
      const resource = { version: 1, hostId: enrollment.hostId };
      await context.checkpoint(resource);
      context.signal.throwIfAborted();
      context.report.step("Run the enrollment command shown in the picker");
      const { hostId } =
        await bb.experimental_machines.enrollments.waitForConnection({
          enrollmentId: enrollment.id,
          timeoutMs: 15 * 60_000,
          signal: context.signal,
        });
      context.report.step("Machine connected");
      return { status: "created", hostId, resource };
    },
    async reconcileCleanup() {
      return { status: "removed" };
    },
    async remove(context) {
      context.report.step(
        `Uninstall manually on the machine: bb machine uninstall --host-id ${context.hostId}`,
      );
      return { status: "removed" };
    },
  });
}
