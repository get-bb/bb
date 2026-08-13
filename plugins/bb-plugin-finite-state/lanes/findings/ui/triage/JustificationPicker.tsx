import { Label } from "@bb/shared-ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@bb/shared-ui/select";
import type { VexJustification } from "../../../../lib/remote/types.js";
import { VEX_JUSTIFICATION_VALUES } from "./validation.js";

const EXPLANATIONS: Record<VexJustification, string> = {
  CODE_NOT_PRESENT: "The vulnerable code is absent from the product.",
  CODE_NOT_REACHABLE: "Build-specific analysis found no path to the vulnerable code.",
  REQUIRES_CONFIGURATION: "A configuration the product does not use is required.",
  REQUIRES_DEPENDENCY: "A dependency the product does not include is required.",
  REQUIRES_ENVIRONMENT: "The vulnerable behavior requires a different environment.",
  PROTECTED_BY_COMPILER: "Compiler hardening prevents exploitation.",
  PROTECTED_AT_RUNTIME: "Runtime controls prevent exploitation.",
  PROTECTED_AT_PERIMETER: "A perimeter control prevents access to the vulnerable path.",
  PROTECTED_BY_MITIGATING_CONTROL: "Another documented control mitigates exploitation.",
};

export function JustificationPicker({ value, onChange }: {
  value: VexJustification | null;
  onChange(value: VexJustification): void;
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <Label id="triage-justification-label">Justification <span className="text-destructive">required</span></Label>
      <Select onValueChange={value => onChange(value as VexJustification)} value={value ?? undefined}>
        <SelectTrigger aria-describedby="triage-justification-help" aria-label="Justification" aria-labelledby="triage-justification-label" id="triage-justification">
          <SelectValue placeholder="Choose one of nine VEX justifications" />
        </SelectTrigger>
        <SelectContent>
          {VEX_JUSTIFICATION_VALUES.map((justification, index) => (
            <SelectItem key={justification} value={justification}>
              {index + 1}. {justification.replaceAll("_", " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs leading-5 text-muted-foreground" id="triage-justification-help">
        {value ? EXPLANATIONS[value] : "CycloneDX requires a specific justification for NOT_AFFECTED."}
      </p>
    </div>
  );
}
