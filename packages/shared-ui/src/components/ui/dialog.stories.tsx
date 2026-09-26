import { useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog.js";
import { Button } from "./button.js";
import { Input } from "./input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Dialog",
};

function ConfirmDialogDemo() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Delete project
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete project?</DialogTitle>
          <DialogDescription>
            This removes the project and its presets. Threads already created
            from it are not affected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive" size="sm">
              Delete
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormDialogDemo() {
  const [name, setName] = useState("");
  const [environmentKind, setEnvironmentKind] = useState("project-default");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">New preset</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New preset</DialogTitle>
          <DialogDescription>
            Presets pick the provider, model, and guardrails for dispatched
            threads.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Name</label>
            <Input
              autoFocus
              value={name}
              placeholder="e.g. Sonnet · high"
              onChange={(event) => setName(event.target.value)}
              className="h-8"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">
              Execution environment
            </label>
            <Select value={environmentKind} onValueChange={setEnvironmentKind}>
              <SelectTrigger aria-label="Execution environment" className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project-default">
                  Project default
                </SelectItem>
                <SelectItem value="new-worktree">New worktree</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button size="sm">Create preset</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Confirm dialog"
        hint="plugins/tasks/components/confirm-dialog.tsx — title, description, cancel/destructive footer"
      >
        <ConfirmDialogDemo />
      </StoryRow>
      <StoryRow
        label="Form dialog"
        hint="plugins/tasks/views/manage/preset-dialog.tsx — fields composed inside the dialog body, simplified"
      >
        <FormDialogDemo />
      </StoryRow>
    </StoryCard>
  );
}
