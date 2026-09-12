import type { BbProjectOption } from "../../shared/contract.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";

const NO_LINK = "__none__";

export function BbProjectLinkPicker({
  value,
  onChange,
  bbProjects,
  noneLabel = "Not linked",
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  bbProjects: readonly BbProjectOption[];
  noneLabel?: string;
}) {
  const unavailableSelection =
    value !== null && !bbProjects.some((project) => project.id === value)
      ? value
      : null;
  return (
    <Select
      value={value ?? NO_LINK}
      onValueChange={(next) => onChange(next === NO_LINK ? null : next)}
    >
      <SelectTrigger aria-label="Linked bb project" className="h-8">
        <SelectValue>
          {bbProjects.find((project) => project.id === value)?.name ??
            unavailableSelection ??
            noneLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_LINK}>{noneLabel}</SelectItem>
        {unavailableSelection !== null ? (
          <SelectItem value={unavailableSelection}>
            Unavailable · {unavailableSelection}
          </SelectItem>
        ) : null}
        {bbProjects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
