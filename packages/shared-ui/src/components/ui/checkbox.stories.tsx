import { useState } from "react";
import { Checkbox } from "./checkbox.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Checkbox",
};

interface Host {
  id: string;
  name: string;
  status: "connected" | "offline";
}

const HOSTS: readonly Host[] = [
  { id: "host-1", name: "Josh's MacBook Pro", status: "connected" },
  { id: "host-2", name: "build-vm-02", status: "connected" },
  { id: "host-3", name: "staging-runner", status: "offline" },
];

function HostChecklistDemo() {
  const [selected, setSelected] = useState<readonly string[]>(["host-1"]);

  return (
    <div className="w-80 divide-y divide-border rounded-md border border-border">
      {HOSTS.map((host) => {
        const isSelected = selected.includes(host.id);
        const isOnlySelectedHost = isSelected && selected.length === 1;
        return (
          <div
            key={host.id}
            className="flex min-h-10 items-center gap-3 px-3 py-2"
          >
            <Checkbox
              checked={isSelected}
              disabled={isOnlySelectedHost}
              aria-label={host.name}
              onCheckedChange={(checked) => {
                setSelected((current) =>
                  checked === true
                    ? [...current, host.id]
                    : current.filter((id) => id !== host.id),
                );
              }}
            />
            <span className="min-w-0 flex-1 truncate text-sm">
              {host.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {host.status === "connected" ? "Connected" : "Offline"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Host checklist"
        hint="plugins/keep-awake/app.tsx — per-row checklist checkbox; last checked row disables to avoid empty selection"
      >
        <HostChecklistDemo />
      </StoryRow>
    </StoryCard>
  );
}
