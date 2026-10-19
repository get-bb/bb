import type { Host } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { SettingsStoryFixtures } from "../../../.ladle/settings-story-fixtures";
import { SettingsStoryChrome } from "../../../.ladle/story-settings-chrome";
import { MachinesSettingsSection } from "./MachinesSettingsSection";

export default { title: "settings/Machine attention" };

const laptop = makeHost({
  id: "host_local",
  name: "Work laptop",
  status: "disconnected",
});
const desktop = makeHost({
  id: "host_remote",
  name: "Studio desktop",
  status: "disconnected",
});
const cleanup = makeHost({
  id: "host_cleanup",
  name: "Build server",
  status: "disconnected",
  lifecycle: {
    ...laptop.lifecycle,
    phase: "removing",
    message: "Provider credentials expired.",
    teardown: { status: "failed", attempt: 1 },
  },
});

function Machines({ hosts }: { hosts: Host[] }) {
  return (
    <SettingsStoryFixtures hosts={hosts}>
      <SettingsStoryChrome activeSection="machines">
        <MachinesSettingsSection />
      </SettingsStoryChrome>
    </SettingsStoryFixtures>
  );
}

export function SingleOffline() {
  return <Machines hosts={[laptop, { ...desktop, status: "connected" }]} />;
}
export function MultipleOffline() {
  return <Machines hosts={[laptop, desktop]} />;
}
export function CleanupFailed() {
  return <Machines hosts={[cleanup]} />;
}
export function MixedIssues() {
  return <Machines hosts={[laptop, cleanup]} />;
}
