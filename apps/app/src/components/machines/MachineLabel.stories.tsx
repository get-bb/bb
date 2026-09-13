import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { MachineLabel } from "./MachineLabel";

export default {
  title: "machines/Machine Label",
};

const modalProvider = {
  id: "modal-sandbox",
  displayName: "Modal Sandbox",
  icon: "Cloud",
  logoUrl: null,
};

export function States() {
  return (
    <StoryCard labelWidth="160px">
      <StoryRow label="persistent">
        <MachineLabel host={makeHost({ name: "Michael’s MacBook Pro" })} />
      </StoryRow>
      <StoryRow label="ephemeral">
        <MachineLabel
          host={makeHost({
            name: "Modal sandbox ugxe6e",
            type: "ephemeral",
            machineProviderId: modalProvider.id,
          })}
          machineProvider={modalProvider}
        />
      </StoryRow>
    </StoryCard>
  );
}
