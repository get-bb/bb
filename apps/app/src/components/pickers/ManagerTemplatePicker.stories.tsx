import type { ManagerTemplateSummary } from "@bb/server-contract";
import { ManagerTemplatePicker } from "./ManagerTemplatePicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "pickers/Manager Template Picker",
};

const noop = () => {};

const multipleTemplates: readonly ManagerTemplateSummary[] = [
  { name: "default", isActive: true },
  { name: "sawyer-next", isActive: false },
];

const nonDefaultActive: readonly ManagerTemplateSummary[] = [
  { name: "default", isActive: false },
  { name: "sawyer-next", isActive: true },
];

const singleTemplate: readonly ManagerTemplateSummary[] = [
  { name: "default", isActive: true },
];

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="multiple, default active"
        hint="picker shows two options, default is preselected"
      >
        <ManagerTemplatePicker
          templates={multipleTemplates}
          value="default"
          onChange={noop}
        />
      </StoryRow>
      <StoryRow
        label="multiple, non-default active"
        hint="active marker on sawyer-next"
      >
        <ManagerTemplatePicker
          templates={nonDefaultActive}
          value="sawyer-next"
          onChange={noop}
        />
      </StoryRow>
      <StoryRow
        label="single template"
        hint="dialog hides the picker in this case — shown here for completeness"
      >
        <ManagerTemplatePicker
          templates={singleTemplate}
          value="default"
          onChange={noop}
        />
      </StoryRow>
      <StoryRow label="open menu" hint="defaultOpen + modal=false">
        <ManagerTemplatePicker
          templates={multipleTemplates}
          value="default"
          onChange={noop}
          defaultOpen
          modal={false}
        />
      </StoryRow>
    </StoryCard>
  );
}
