import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { RadioGroup, RadioGroupItem } from "@bb/shared-ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SETTINGS_INLINE_SELECT_CLASS,
  SettingsList,
  SettingsListAction,
  SettingsListItem,
  SettingsListMessage,
} from "@bb/shared-ui/settings-section";
import { Switch } from "@bb/shared-ui/switch";

export default { title: "settings/Settings list" };

function CountSelect({ value, inherit }: { value: string; inherit?: string }) {
  const [current, setCurrent] = useState(value);
  return (
    <Select value={current} onValueChange={setCurrent}>
      <SelectTrigger
        className={cn(
          SETTINGS_INLINE_SELECT_CLASS,
          current === "inherit" && "text-subtle-foreground",
        )}
        aria-label="Count"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {inherit === undefined ? null : (
          <SelectItem value="inherit">{inherit}</SelectItem>
        )}
        {["Off", "1", "2", "3", "4"].map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Shapes() {
  const [enabled, setEnabled] = useState(true);
  return (
    <div className="mx-auto max-w-2xl space-y-8 p-8">
      <SettingsList
        title="Nested with inherited values"
        description="Each machine keeps the project's count unless you set its own."
        dividers={false}
      >
        <SettingsListItem title="demo-app" control={<CountSelect value="1" />}>
          <SettingsListItem
            title="Build box"
            meta={["2 ready"]}
            control={<CountSelect value="2" inherit="Project (1)" />}
          />
          <SettingsListItem
            title="Laptop"
            meta={["1 ready", "1 setting up"]}
            control={<CountSelect value="inherit" inherit="Project (1)" />}
          />
          <SettingsListItem
            title="devbox"
            meta={["0 ready"]}
            error="Setup failed in a warm worktree, trying again in 10 minutes: pnpm install exited with code 1 after resolving 1,204 packages"
            control={<CountSelect value="2" inherit="Project (1)" />}
          />
          <SettingsListAction onClick={() => {}}>
            Add machine
          </SettingsListAction>
        </SettingsListItem>
        <SettingsListItem
          title="docs-site"
          meta={["0 ready"]}
          error="Setup failed in a warm worktree, trying again in 10 minutes: pnpm install exited with code 1"
          control={<CountSelect value="1" />}
        />
      </SettingsList>

      <SettingsList
        title="Flat with meta and an input"
        description="Auto allows one thread per available processor."
      >
        <SettingsListItem
          title="Laptop"
          meta={["10 processors"]}
          control={<Input className="w-28" placeholder="Auto (10)" />}
        />
        <SettingsListItem
          title="Build box"
          meta={["32 processors", "Offline"]}
          control={<Input className="w-28" placeholder="Auto (32)" />}
        />
      </SettingsList>

      <SettingsList>
        <SettingsListItem
          title="Prevent idle sleep"
          description="Keep selected Macs awake while bb is running. Closing the lid or choosing Sleep still sleeps the Mac."
          control={
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Prevent idle sleep"
            />
          }
        />
      </SettingsList>

      <RadioGroup className="block" defaultValue="selected">
        <SettingsList
          title="Leading controls"
          description="Choose which Macs to keep awake."
          dividers={false}
        >
          <SettingsListItem
            leading={<RadioGroupItem value="all" aria-label="All hosts" />}
            title="All hosts"
            description="Include hosts added in the future."
          />
          <SettingsListItem
            leading={
              <RadioGroupItem value="selected" aria-label="Specific hosts" />
            }
            title="Specific hosts"
            description="Choose individual Macs below."
          >
            <SettingsListItem
              leading={<Checkbox defaultChecked aria-label="Laptop" />}
              title="Laptop"
              meta={["Connected"]}
            />
            <SettingsListItem
              leading={<Checkbox aria-label="Build box" />}
              title="Build box"
              meta={["Offline"]}
            />
          </SettingsListItem>
        </SettingsList>
      </RadioGroup>

      <SettingsList title="Badges, descriptions and actions">
        <SettingsListItem
          leading={
            <Icon name="Toolbox" className="size-4 text-muted-foreground" />
          }
          title="Claude Agent"
          badge="Update available"
          meta={["1.2.0"]}
          description="Runs npx -y claude-acp@1.2.0"
          control={
            <>
              <Button size="sm">Update</Button>
              <Button size="sm" variant="outline">
                Remove
              </Button>
            </>
          }
        />
        <SettingsListItem
          leading={
            <Icon name="Toolbox" className="size-4 text-muted-foreground" />
          }
          title="Goose"
          meta={["0.9.3"]}
          control={<Button size="sm">Add</Button>}
        />
      </SettingsList>

      <SettingsList title="Messages">
        <SettingsListMessage>No projects yet.</SettingsListMessage>
      </SettingsList>
      <SettingsList>
        <SettingsListMessage tone="error">
          Could not load projects: the server is unreachable.
        </SettingsListMessage>
      </SettingsList>
    </div>
  );
}
