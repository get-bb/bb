import type { BbPluginApi } from "@get-bb/plugin-sdk";

function quote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

export default function manualMachinePlugin(bb: BbPluginApi): void {
  bb.experimental_machines.register({
    id: "manual",
    displayName: "Existing machine",
    icon: "Terminal",
    policy: {
      idleSuspendMs: null,
      retire: { after: "never" },
      removeRetryMs: 60_000,
    },
    async create(context) {
      context.signal.throwIfAborted();
      const enrollment = await bb.experimental_machines.enrollments.prepare({
        key: context.key,
      });
      const resource = { version: 1, hostId: enrollment.hostId };
      await context.checkpoint(resource);
      context.signal.throwIfAborted();
      if (enrollment.state === "pending") {
        context.report.step(
          `Run on the target machine:\nexport BB_ENROLLMENT=${quote(JSON.stringify(enrollment.bootstrap))}\nif command -v bb >/dev/null 2>&1; then\n  bb machine enroll --bootstrap-env BB_ENROLLMENT && bb machine start --host-id ${quote(enrollment.hostId)}\nelse\n  curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 ${quote(new URL("/install.sh", enrollment.bootstrap.serverUrl).href)} | sh -s -- --bootstrap-env BB_ENROLLMENT\nfi\nunset BB_ENROLLMENT`,
        );
      } else {
        context.report.step(
          `Run on the target machine:\nbb machine start --host-id ${quote(enrollment.hostId)}`,
        );
      }
      const { hostId } =
        await bb.experimental_machines.enrollments.waitForConnection({
          enrollmentId: enrollment.id,
          timeoutMs: 15 * 60_000,
          signal: context.signal,
        });
      context.report.step("Machine connected");
      return { status: "created", hostId, resource };
    },
    async experimental_reconcileCleanup() {
      return { status: "removed" };
    },
    async remove(context) {
      context.report.step(
        `Uninstall manually on the machine: bb machine uninstall --host-id ${quote(context.hostId)}`,
      );
      return { status: "removed" };
    },
  });
}
