import { useState, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { PanelStage } from "../ThreadMetadataContent.fixtures";
import { ThreadMetadataCard } from "../ThreadMetadataContent";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { InfoList, InfoListRow, InfoRowTime, InfoSection } from "./info-list";

export default {
  title: "right-panel/Info/List primitives",
};

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const noop = () => {};

const ROWS = Array.from({ length: 9 }, (_, index) => ({
  id: `row-${index}`,
  name:
    index === 0
      ? "A row whose name is long enough to truncate before the trailing metadata"
      : `Row ${index + 1}`,
  at: NOW - (index + 1) * 3 * HOUR,
}));

function Stage({ children }: { children: ReactNode }) {
  return (
    <PanelStage>
      <ThreadMetadataCard>{children}</ThreadMetadataCard>
    </PanelStage>
  );
}

export function Rows() {
  return (
    <StoryCard>
      <StoryRow
        label="row anatomy"
        hint="leading glyph, name, context hint, hover action, trailing metadata"
      >
        <Stage>
          <InfoSection label="Section" count={3}>
            <InfoList
              items={ROWS.slice(0, 3)}
              getKey={(row) => row.id}
              renderItem={(row) => (
                <InfoListRow
                  leading={
                    <Icon
                      name="File"
                      className="size-3 text-subtle-foreground"
                      aria-hidden
                    />
                  }
                  name={row.name}
                  context={row.id === "row-1" ? "folder" : null}
                  target={{ kind: "button", onSelect: noop }}
                  actions={[{ icon: "Copy", label: "Copy", onSelect: noop }]}
                  trailing={<InfoRowTime timestamp={row.at} now={NOW} />}
                  selected={row.id === "row-2"}
                />
              )}
            />
          </InfoSection>
        </Stage>
      </StoryRow>
      <StoryRow
        label="overflow and timeline rail"
        hint="five rows, then an 'N more' row that expands in place"
      >
        <Stage>
          <InfoSection label="Section" count={ROWS.length}>
            <InfoList
              items={ROWS}
              rail
              getKey={(row) => row.id}
              renderItem={(row) => (
                <InfoListRow
                  leading={
                    <span className="size-[7px] rounded-full border border-subtle-foreground/60 bg-background" />
                  }
                  name={row.name}
                  target={null}
                  trailing={<InfoRowTime timestamp={row.at} now={NOW} />}
                />
              )}
            />
          </InfoSection>
        </Stage>
      </StoryRow>
      <StoryRow
        label="collapsible heading"
        hint="click the heading to collapse; the heading highlights on hover"
      >
        <Stage>
          <CollapsibleSection />
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}

function CollapsibleSection() {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <InfoSection
      label="Section"
      count={3}
      collapse={{ collapsed, setCollapsed }}
    >
      <InfoList
        items={ROWS.slice(0, 3)}
        getKey={(row) => row.id}
        renderItem={(row) => (
          <InfoListRow
            leading={
              <Icon
                name="File"
                className="size-3 text-subtle-foreground"
                aria-hidden
              />
            }
            name={row.name}
            target={{ kind: "button", onSelect: noop }}
          />
        )}
      />
    </InfoSection>
  );
}
