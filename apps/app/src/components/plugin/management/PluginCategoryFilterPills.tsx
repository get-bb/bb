import { ToggleGroup, ToggleGroupItem } from "@bb/shared-ui/toggle-group";

const ALL_CATEGORIES = "all";

export function PluginCategoryFilterPills({
  categories,
  value,
  onValueChange,
}: {
  categories: readonly string[];
  value: string | null;
  onValueChange: (category: string | null) => void;
}) {
  if (categories.length === 0) return null;

  return (
    <ToggleGroup
      type="single"
      value={value ?? ALL_CATEGORIES}
      onValueChange={(next) => {
        if (next.length === 0) return;
        onValueChange(next === ALL_CATEGORIES ? null : next);
      }}
      aria-label="Filter plugins by category"
      className="flex-wrap justify-start gap-2 py-2"
    >
      <ToggleGroupItem
        value={ALL_CATEGORIES}
        aria-label="Show all plugin categories"
        className="h-7 min-w-0 rounded-full border border-border bg-transparent px-3 text-xs text-muted-foreground shadow-none hover:bg-secondary/70 hover:text-foreground data-[state=on]:border-transparent data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground"
      >
        All
      </ToggleGroupItem>
      {categories.map((category) => (
        <ToggleGroupItem
          key={category}
          value={category}
          className="h-7 min-w-0 rounded-full border border-border bg-transparent px-3 text-xs text-muted-foreground shadow-none hover:bg-secondary/70 hover:text-foreground data-[state=on]:border-transparent data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground"
        >
          {category}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
