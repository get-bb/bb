import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  PROJECT_COLOR_PALETTE,
  projectColorCss,
  type ProjectColorId,
} from "../../shared/project-colors.js";

interface ProjectColorDialogProps {
  open: boolean;
  projectName: string;
  selectedColorId: ProjectColorId;
  isOverridden: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectColor: (colorId: ProjectColorId | null) => void;
}

export function ProjectColorDialog({
  open,
  projectName,
  selectedColorId,
  isOverridden,
  onOpenChange,
  onSelectColor,
}: ProjectColorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Project color</DialogTitle>
          <DialogDescription>
            Choose an accent color for {projectName} in the sidebar.
          </DialogDescription>
        </DialogHeader>
        <div
          className="grid grid-cols-4 gap-1.5"
          role="group"
          aria-label="Project colors"
        >
          {PROJECT_COLOR_PALETTE.map((color) => {
            const isSelected = selectedColorId === color.id;
            return (
              <button
                key={color.id}
                type="button"
                aria-pressed={isSelected}
                aria-label={color.name}
                onClick={() => onSelectColor(color.id)}
                className={cn(
                  "flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-md px-1 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-pressed:bg-state-active aria-pressed:text-foreground",
                )}
              >
                <span
                  className="relative flex size-7 items-center justify-center rounded-full ring-1 ring-foreground/20 ring-inset"
                  style={{ backgroundColor: projectColorCss(color.id) }}
                >
                  {isSelected ? (
                    <Icon
                      name="Check"
                      className="size-3.5 text-background"
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
                <span className="w-full truncate text-center">
                  {color.name}
                </span>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!isOverridden}
            onClick={() => onSelectColor(null)}
          >
            Use automatic color
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
