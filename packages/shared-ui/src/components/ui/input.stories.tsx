import { useId, useState } from "react";
import { Input } from "./input.js";
import { Button } from "./button.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Input",
};

function CreateSectionFormDemo() {
  const inputId = useId();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="w-64 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() === "") {
          setError("Name is required");
          return;
        }
        setPending(true);
        setTimeout(() => {
          setPending(false);
          setError(null);
          setName("");
        }, 400);
      }}
    >
      <div className="space-y-2">
        <Input
          id={inputId}
          aria-label="Section name"
          value={name}
          autoCapitalize="sentences"
          autoCorrect="off"
          spellCheck={false}
          disabled={pending}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Creating…" : "Create section"}
      </Button>
    </form>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Dialog form field"
        hint="plugins/thread-list/ThreadSectionCreateDialog.tsx — required text input in a dialog form with inline validation"
      >
        <CreateSectionFormDemo />
      </StoryRow>
    </StoryCard>
  );
}
