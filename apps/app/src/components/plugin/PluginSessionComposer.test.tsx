// @vitest-environment jsdom
import { useState, type ComponentProps } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalSessionComposerProps } from "@get-bb/plugin-sdk";
import type { PromptBoxInternal } from "@/components/promptbox/PromptBoxInternal";
import { PluginSessionComposer } from "./PluginSessionComposer";

const captured = vi.hoisted(() => ({
  props: null as ComponentProps<typeof PromptBoxInternal> | null,
  release: vi.fn(),
  register: vi.fn(),
}));
vi.mock("@/components/promptbox/PromptBoxInternal", () => ({
  PromptBoxInternal: (props: ComponentProps<typeof PromptBoxInternal>) => {
    captured.props = props;
    return <div data-testid="native-editor">{props.value}</div>;
  },
}));
vi.mock("@/components/promptbox/usePromptVoice", () => ({
  usePromptVoice: () => ({
    state: "idle",
    isSupported: true,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    stream: null,
  }),
}));
vi.mock("@/lib/attachment-local-previews", () => ({
  releaseLocalAttachmentPreview: captured.release,
  registerLocalAttachmentPreview: captured.register,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  captured.props = null;
});
function props() {
  if (!captured.props) throw Error("Composer not mounted");
  return captured.props;
}
function Controlled({
  onSubmit,
  ...rest
}: Omit<ExperimentalSessionComposerProps, "value" | "onChange">) {
  const [value, onChange] = useState("Check this");
  return (
    <PluginSessionComposer
      {...rest}
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
    />
  );
}

describe("external session composer", () => {
  it("keeps text and files after failure and clears them only after successful retry", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(Error("Mac offline"))
      .mockResolvedValueOnce(undefined);
    render(<Controlled allowAttachments onSubmit={submit} />);
    const image = new File(["picture"], "screen.png", { type: "image/png" });
    await act(async () => {
      await props().attachments?.onAttachFiles?.([image]);
    });
    await act(async () => {
      props().onSubmit();
    });
    expect(screen.getByRole("alert").textContent).toBe("Mac offline");
    expect(props().value).toBe("Check this");
    expect(props().attachments?.items).toHaveLength(1);
    expect(submit).toHaveBeenCalledWith({ text: "Check this", files: [image] });
    await act(async () => {
      props().onSubmit();
    });
    expect(props().value).toBe("");
    expect(props().attachments?.items).toHaveLength(0);
    expect(captured.release).toHaveBeenCalledTimes(1);
  });
  it("bounds attachments and releases previews on unmount", async () => {
    const mounted = render(
      <Controlled
        allowAttachments
        attachmentLimits={{ count: 1, bytesPerFile: 10 }}
        onSubmit={vi.fn()}
      />,
    );
    await act(async () => {
      await props().attachments?.onAttachFiles?.([
        new File(["too much content"], "large.png"),
      ]);
    });
    expect(props().attachments?.items).toHaveLength(0);
    await act(async () => {
      await props().attachments?.onAttachFiles?.([
        new File(["x"], "tiny.png", { type: "image/png" }),
      ]);
    });
    expect(props().attachments?.items).toHaveLength(1);
    await act(async () => {
      await props().attachments?.onAttachFiles?.([
        new File(["x"], "extra.png"),
      ]);
    });
    expect(props().attachments?.items).toHaveLength(1);
    mounted.unmount();
    expect(captured.release).toHaveBeenCalledTimes(1);
  });
  it("filters supplied commands and keeps selection in the draft without dispatch", async () => {
    const submit = vi.fn();
    render(
      <Controlled
        commands={[
          { name: "review", description: "Review changes" },
          { name: "test", description: "Run checks" },
        ]}
        onSubmit={submit}
      />,
    );
    await act(async () => props().typeahead.command.onQueryChange("review"));
    expect(
      props().typeahead.command.suggestions.map((item) => item.name),
    ).toEqual(["review"]);
    await act(async () => props().onChange("/review ", []));
    expect(props().value).toBe("/review ");
    expect(submit).not.toHaveBeenCalled();
    expect(props().attachments?.onAttachFiles).toBeUndefined();
    expect(props().suppressPluginComposerCustomizations).toBe(true);
    expect(props().voice?.isSupported).toBe(true);
  });
  it("locks duplicate submissions and file changes while a send is pending", async () => {
    let finish: (() => void) | undefined;
    const submit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<Controlled allowAttachments onSubmit={submit} />);
    const before = props();
    await act(async () => {
      before.onSubmit();
      before.onSubmit();
      await before.attachments?.onAttachFiles?.([new File(["x"], "late.txt")]);
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(props().attachments?.items).toHaveLength(0);
    expect(props().submission?.disabled).toBe(true);
    await act(async () => finish?.());
  });
});
