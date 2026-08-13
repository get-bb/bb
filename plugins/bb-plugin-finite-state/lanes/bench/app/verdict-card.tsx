import { Badge } from "@bb/shared-ui/badge";
import { Icon } from "@bb/shared-ui/icon";

/** Compiling WP-54 seam. WP-55 replaces this component in place. */
export function VerdictCard(): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-background p-3">
      <Icon className="text-muted-foreground" name="Target" />
      <div><p className="text-sm font-medium">OTA verdict</p><p className="text-xs text-muted-foreground">Verdict evaluation is supplied by WP-55.</p></div>
      <Badge className="ml-auto" variant="outline">Pending evaluator</Badge>
    </div>
  );
}
