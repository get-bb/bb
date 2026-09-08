import { useEffect, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import type { Recipe } from "./catalogue/model.js";
import { errorText, lines } from "./ui-state.js";

type Input = Omit<
  Recipe,
  "recipeId" | "revision" | "recipeHash" | "baseDigest" | "createdAt"
> & { expectedRevision: number };

export function RecipeEditor({
  projectId,
  recipe,
  save,
  reload,
  saved,
  dirtyChanged,
}: {
  dirtyChanged: (dirty: boolean) => void;
  projectId: string;
  recipe: Recipe | null;
  save: (input: Input) => Promise<Recipe>;
  reload: () => Promise<Recipe>;
  saved: (recipe: Recipe) => void;
}) {
  const [revision, setRevision] = useState(recipe?.revision ?? 0);
  const [text, setText] = useState(
    recipe?.dockerfileText ?? "RUN node --version\n",
  );
  const [include, setInclude] = useState(
    recipe?.contextRules.include.join("\n") ?? "",
  );
  const [exclude, setExclude] = useState(
    recipe?.contextRules.exclude.join("\n") ?? "",
  );
  const [smoke, setSmoke] = useState(recipe?.smoke.commands.join("\n") ?? "");
  useEffect(() => {
    dirtyChanged(
      text !== recipe?.dockerfileText ||
        include !== recipe.contextRules.include.join("\n") ||
        exclude !== recipe.contextRules.exclude.join("\n") ||
        smoke !== recipe.smoke.commands.join("\n"),
    );
  }, [text, include, exclude, smoke, recipe, dirtyChanged]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const inputClass =
    "min-h-24 w-full rounded-md border border-border bg-background p-3 font-mono text-sm text-foreground";
  function accept(value: Recipe) {
    setRevision(value.revision);
    saved(value);
    setFailed(false);
  }
  async function submit() {
    setBusy(true);
    try {
      const value = await save({
        projectId,
        expectedRevision: revision,
        dockerfileText: text,
        contextRules: { include: lines(include), exclude: lines(exclude) },
        smoke: {
          commands: lines(smoke),
          timeoutSeconds: recipe?.smoke.timeoutSeconds ?? 120,
        },
      });
      accept(value);
      setMessage(`Saved revision ${value.revision}`);
    } catch (error) {
      setFailed(true);
      setMessage(
        `${errorText(error)}. Your draft is kept; reload the stored recipe to review changes before saving again.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      aria-label="Stored Dockerfile recipe"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Dockerfile recipe</h3>
        <span className="text-xs text-muted-foreground">
          Stored in bb · revision {revision}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        bb supplies the credential-free base. Use RUN, COPY, ENV, WORKDIR and
        ARG. This recipe is stored per project in bb, outside the repository.
      </p>
      <textarea
        aria-label="Dockerfile recipe"
        className={`${inputClass} min-h-64`}
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          Context includes (one pattern per line; explicit patterns required)
          <textarea
            aria-label="Context includes"
            className={inputClass}
            value={include}
            onChange={(event) => setInclude(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Context excludes
          <textarea
            aria-label="Context excludes"
            className={inputClass}
            value={exclude}
            onChange={(event) => setExclude(event.target.value)}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        Smoke commands (one per line)
        <textarea
          aria-label="Smoke commands"
          className={inputClass}
          placeholder="npm run check"
          value={smoke}
          onChange={(event) => setSmoke(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? "Saving…" : "Save recipe"}
        </Button>
        <label className="cursor-pointer text-xs underline">
          Import Dockerfile
          <input
            className="sr-only"
            type="file"
            aria-label="Import Dockerfile"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file)
                void file
                  .text()
                  .then(setText)
                  .catch((error) => setMessage(errorText(error)));
            }}
          />
        </label>
        <Button
          variant="outline"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([text], { type: "text/plain" }),
            );
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "Dockerfile";
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Export
        </Button>
        {failed && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void reload()
                .then((value) => {
                  setText(value.dockerfileText);
                  setInclude(value.contextRules.include.join("\n"));
                  setExclude(value.contextRules.exclude.join("\n"));
                  setSmoke(value.smoke.commands.join("\n"));
                  accept(value);
                  setMessage(`Loaded stored revision ${value.revision}`);
                })
                .catch((error) => setMessage(errorText(error)))
                .finally(() => setBusy(false));
            }}
          >
            Load stored recipe
          </Button>
        )}
      </div>
      {message && (
        <p role={failed ? "alert" : "status"} className="text-xs">
          {message}
        </p>
      )}
    </section>
  );
}
