import { MachinePickerUI } from "./MachinePicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { HOST_IDS, makeHost } from "../../../.ladle/story-fixtures";

export default {
  title: "pickers/Machine Picker",
};

const hosts = [
  makeHost({ id: HOST_IDS.local, name: "Michael’s MacBook Pro" }),
  makeHost({ id: HOST_IDS.remote, name: "Studio Mac mini" }),
  makeHost({ id: "host_build", name: "Build server" }),
  makeHost({ id: "host_office", name: "Office Mac Studio" }),
  makeHost({ id: "host_travel", name: "Travel laptop" }),
  makeHost({ id: "host_dev_vm", name: "Development VM" }),
];

const noop = () => {};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="machine" hint="six available machines">
        <MachinePickerUI
          hosts={hosts}
          localDaemonHostId={HOST_IDS.local}
          primaryHostId={HOST_IDS.local}
          selectedHostId={HOST_IDS.local}
          onChange={noop}
          modal={false}
          multiMachinePickerEnabled
        />
      </StoryRow>
    </StoryCard>
  );
}
