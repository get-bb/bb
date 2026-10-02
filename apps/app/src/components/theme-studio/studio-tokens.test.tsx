// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { customThemeNameSchema } from "@bb/domain";
import {
  buildPreviewCss,
  buildStudioThemeCss,
  ADVANCED_TOKEN_NAMES,
  GUIDED_TOKEN_NAMES,
  STUDIO_TOKEN_LABELS,
  type ThemeStudioTokens,
} from "./studio-tokens";

const LIGHT: ThemeStudioTokens = {
  canvas: "#f7f8fa",
  ink: "#1c2024",
  primary: "#3b6fd4",
  destructive: "#c0392b",
  warning: "#b5730d",
  success: "#2f7d44",
  prMerged: "#8250df",
  fileAccent: "#3b6fd4",
  diffAdded: "#2f7d44",
  diffRemoved: "#c0392b",
};

const DARK: ThemeStudioTokens = {
  canvas: "#16181d",
  ink: "#e6e8ec",
  primary: "#7aa2f7",
  destructive: "#e06c5f",
  warning: "#e0af68",
  success: "#8fbf7f",
  prMerged: "#bb9af7",
  fileAccent: "#7aa2f7",
  diffAdded: "#8fbf7f",
  diffRemoved: "#e06c5f",
};

afterEach(cleanup);

async function openSourceMenu(trigger: RegExp | string) {
  fireEvent.pointerDown(screen.getByRole("button", { name: trigger }), {
    button: 0,
  });
  await screen.findByRole("menu");
}

describe("studio token css", () => {
  it("emits the mode block matching the requested scheme", () => {
    expect(buildPreviewCss(LIGHT, "light")).toContain(":root, .light {");
    expect(buildPreviewCss(DARK, "dark")).toContain(".dark {");
  });

  it("keeps every guided and advanced token out of the light block", () => {
    const css = buildPreviewCss(LIGHT, "light");
    for (const token of [...GUIDED_TOKEN_NAMES, ...ADVANCED_TOKEN_NAMES]) {
      const variable = `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      expect(css).toContain(`${variable}: `);
    }
  });

  it("derives the neutral ramp from the anchors rather than hardcoding it", () => {
    const css = buildPreviewCss(LIGHT, "light");
    expect(css).toContain("--secondary: color-mix(in oklch, var(--ink) 8%");
    expect(css).toContain("--border: color-mix(in oklch, var(--ink) 14%");
    expect(css).toContain(
      "--muted-foreground: color-mix(in oklch, var(--ink) 70%",
    );
  });

  it("mixes translucent state tokens in oklab, not oklch", () => {
    const css = buildPreviewCss(LIGHT, "light");
    expect(css).toContain(
      "--state-hover: color-mix(in oklab, var(--ink) 6%, transparent)",
    );
    expect(css).not.toMatch(/--state-hover: color-mix\(in oklch/);
  });

  it("flows canvas through the derived surfaces, so changing it moves the UI", () => {
    const warmer: ThemeStudioTokens = { ...LIGHT, canvas: "#2b1d16" };
    const css = buildPreviewCss(warmer, "light");
    expect(css).toContain("--canvas: #2b1d16;");
    expect(css).toContain("--background: var(--canvas);");
    expect(css).toContain("--card: var(--canvas);");
    expect(css).not.toContain("--canvas: #f7f8fa;");
  });

  it("aliases surfaces onto the canvas anchor", () => {
    const css = buildPreviewCss(LIGHT, "light");
    expect(css).toContain("--background: var(--canvas);");
    expect(css).toContain("--card: var(--canvas);");
    expect(css).toContain("--popover: var(--canvas);");
  });

  it("emits both modes when rendering a full theme", () => {
    const css = buildStudioThemeCss(LIGHT, DARK);
    expect(css).toContain(":root, .light {");
    expect(css).toContain(".dark {");
    expect(css.indexOf(":root, .light {")).toBeLessThan(css.indexOf(".dark {"));
    expect(css).toContain(LIGHT.canvas);
    expect(css).toContain(DARK.canvas);
  });

  it("labels every token the studio can edit", () => {
    for (const token of [...GUIDED_TOKEN_NAMES, ...ADVANCED_TOKEN_NAMES]) {
      expect(STUDIO_TOKEN_LABELS[token]).toBeTruthy();
    }
  });
});

describe("custom theme names accepted by the studio", () => {
  it("accepts ordinary kebab-case names", () => {
    expect(customThemeNameSchema.safeParse("my-theme").success).toBe(true);
  });

  it("rejects traversal and built-in collisions", () => {
    for (const name of ["../evil", ".hidden", "nord", ""]) {
      expect(customThemeNameSchema.safeParse(name).success).toBe(false);
    }
  });
});

describe("theme studio dialog", () => {
  it("renders the guided controls and hides advanced ones until asked", async () => {
    const { ThemeStudioDialog } = await import("./ThemeStudioDialog");
    render(<ThemeStudioDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByLabelText("Canvas color")).toBeTruthy();
    expect(screen.getByLabelText("Primary color")).toBeTruthy();
    expect(screen.getByText("Show advanced tokens")).toBeTruthy();
    expect(screen.queryByLabelText("Merged PR color")).toBeNull();
  });

  it("scopes the light preview with a .light class so dark ancestors cannot win", async () => {
    const { ThemeStudioDialog } = await import("./ThemeStudioDialog");
    render(<ThemeStudioDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);

    expect(document.querySelector(".dark")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "light" }));

    expect(document.querySelector(".light")).toBeTruthy();
  });

  it("saves as a new theme when a read-only base is loaded", async () => {
    const { ThemeStudioDialog } = await import("./ThemeStudioDialog");
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ThemeStudioDialog
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
        sources={[{ id: "nord", name: "Nord", kind: "builtin" }]}
        loadThemeCss={async () =>
          ":root, .light {\n  --canvas: #eceff4;\n}\n.dark {\n  --canvas: #2e3440;\n}"
        }
      />,
    );

    await openSourceMenu(/new theme/i);
    fireEvent.click(await screen.findByRole("menuitem", { name: /nord/i }));

    const nameField = (await screen.findByLabelText(
      "Save as",
    )) as HTMLInputElement;
    expect(nameField.value).toBe("");
    fireEvent.change(nameField, { target: { value: "nord-copy" } });
    fireEvent.click(screen.getByRole("button", { name: /save as new/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].name).toBe("nord-copy");
    expect(onSave.mock.calls[0][0].css).toContain("#2e3440");
  });

  it("patches only the changed token when overwriting a custom theme", async () => {
    const { ThemeStudioDialog } = await import("./ThemeStudioDialog");
    const onSave = vi.fn().mockResolvedValue(undefined);
    const original = `:root, .light {
  --canvas: #eceff4;
  --ink: #2e3440;
  --primary: #5e81ac;
  --radius: 0.5rem;
}
.dark {
  --canvas: #2e3440;
  --ink: #d8dee9;
}`;
    render(
      <ThemeStudioDialog
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
        sources={[{ id: "mine", name: "mine", kind: "custom" }]}
        loadThemeCss={async () => original}
      />,
    );

    await openSourceMenu(/new theme/i);
    fireEvent.click(await screen.findByRole("menuitem", { name: "mine" }));

    await waitFor(() =>
      expect(
        (screen.getByLabelText("Canvas color") as HTMLElement).textContent,
      ).toContain("#2e3440"),
    );

    fireEvent.click(screen.getByRole("button", { name: "light" }));
    expect(
      (screen.getByLabelText("Canvas color") as HTMLElement).textContent,
    ).toContain("#eceff4");

    fireEvent.click(
      screen.getByRole("button", { name: /overwrite and apply/i }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: /replace mine/i,
    });
    fireEvent.click(within(confirm).getByRole("button", { name: "Overwrite" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0][0];
    expect(payload.name).toBe("mine");
    expect(payload.css).toContain("--radius: 0.5rem;");
    expect(payload.css).toContain("--ink: #2e3440;");
  });

  it("offers delete only for a loaded custom theme", async () => {
    const { ThemeStudioDialog } = await import("./ThemeStudioDialog");
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ThemeStudioDialog
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={onDelete}
        sources={[{ id: "mine", name: "mine", kind: "custom" }]}
        loadThemeCss={async () => ".dark { --canvas: #000; }"}
      />,
    );

    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();

    await openSourceMenu(/new theme/i);
    fireEvent.click(await screen.findByRole("menuitem", { name: "mine" }));

    const remove = await screen.findByRole("button", { name: /^delete$/i });
    fireEvent.click(remove);

    const dialog = await screen.findByRole("dialog", {
      name: /delete mine\?/i,
    });
    expect(dialog).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: /delete theme/i }),
    );

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("mine"));
    rerender(
      <ThemeStudioDialog
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );
  });

  it("renames a loaded custom theme through its own dialog", async () => {
    const { ThemeStudioDialog } = await import("./ThemeStudioDialog");
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(
      <ThemeStudioDialog
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onRename={onRename}
        sources={[{ id: "mine", name: "mine", kind: "custom" }]}
        loadThemeCss={async () => ".dark { --canvas: #000; }"}
      />,
    );

    await openSourceMenu(/new theme/i);
    fireEvent.click(await screen.findByRole("menuitem", { name: "mine" }));

    fireEvent.click(await screen.findByRole("button", { name: /^rename$/i }));
    const dialog = await screen.findByRole("dialog", { name: /rename/i });
    const field = within(dialog).getByLabelText("New name") as HTMLInputElement;
    expect(field.value).toBe("mine-copy");

    fireEvent.change(field, { target: { value: "../escape" } });
    const confirm = within(dialog).getByRole("button", { name: "Rename" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(field, { target: { value: "renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith("mine", "renamed"),
    );
  });

  it("leaves no pointer-events lock on body after opening and closing", async () => {
    const { ThemeStudioDialog } = await import("./ThemeStudioDialog");
    const { rerender } = render(
      <ThemeStudioDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();

    rerender(
      <ThemeStudioDialog
        open={false}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.pointerEvents).not.toBe("none");
  });

  it("exposes a five-step rule strictness control with its current level named", async () => {
    const { ThemeStudioDialog } = await import("./ThemeStudioDialog");
    render(<ThemeStudioDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);

    const slider = screen.getByLabelText("Rule strictness") as HTMLInputElement;
    expect(slider.type).toBe("range");
    expect(slider.min).toBe("1");
    expect(slider.max).toBe("5");
    expect(slider.step).toBe("1");
    expect(slider.value).toBe("3");
    expect(screen.getByText("Expressive")).toBeTruthy();
    expect(screen.queryByText("Unfiltered")).toBeNull();
    expect(screen.queryByText("Structured")).toBeNull();
  });

  it("keeps save disabled until a valid name is entered", async () => {
    const { ThemeStudioDialog } = await import("./ThemeStudioDialog");
    render(<ThemeStudioDialog open onOpenChange={vi.fn()} onSave={vi.fn()} />);

    const save = screen.getByRole("button", { name: /save and apply/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves the generated css under the entered name", async () => {
    const { ThemeStudioDialog } = await import("./ThemeStudioDialog");
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ThemeStudioDialog open onOpenChange={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Save as"), {
      target: { value: "my-theme" },
    });
    const save = screen.getByRole("button", { name: /save and apply/i });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0][0] as { name: string; css: string };
    expect(payload.name).toBe("my-theme");
    expect(payload.css).toContain(":root, .light {");
    expect(payload.css).toContain(".dark {");
    expect(payload.css).toContain("--canvas:");
  });

  it("rejects a name the theme folder rules disallow", async () => {
    const { ThemeStudioDialog } = await import("./ThemeStudioDialog");
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ThemeStudioDialog open onOpenChange={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Save as"), {
      target: { value: "../escape" },
    });

    const save = screen.getByRole("button", { name: /save and apply/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });
});
