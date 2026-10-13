import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Textarea } from "@bb/shared-ui/textarea";
import { parseEnvFile, type ParsedEnvEntry } from "@/lib/parse-env-file";

export function MachineEnvironmentImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (entries: readonly ParsedEnvEntry[]) => void;
}) {
  const [text, setText] = useState("");
  const parsed = parseEnvFile(text);
  const close = () => {
    setText("");
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import from .env</DialogTitle>
          <DialogDescription>
            Paste the contents of a .env file. Existing variables with the same
            name are replaced; nothing is saved until you save the section.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          className="min-h-48 font-mono text-xs"
          aria-label="Environment file contents"
          placeholder={"DATABASE_URL=postgres://…\nSENTRY_DSN=https://…"}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <p className="text-xs text-subtle-foreground" role="status">
          {text.trim() === ""
            ? "Comments and blank lines are ignored."
            : `${parsed.entries.length} variable${parsed.entries.length === 1 ? "" : "s"} found.`}
        </p>
        {parsed.errors.length > 0 && (
          <ul role="alert" className="space-y-1 text-xs text-destructive-text">
            {parsed.errors.slice(0, 5).map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={parsed.entries.length === 0 || parsed.errors.length > 0}
            onClick={() => {
              onImport(parsed.entries);
              close();
            }}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
