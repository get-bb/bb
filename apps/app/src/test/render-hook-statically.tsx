import { renderToStaticMarkup } from "react-dom/server";

export function renderHookStatically<T>(useHook: () => T): T {
  const rendered: { value: T }[] = [];
  function Probe({ onRender }: { onRender: (value: T) => void }) {
    onRender(useHook());
    return null;
  }
  renderToStaticMarkup(
    <Probe onRender={(value) => rendered.push({ value })} />,
  );
  const last = rendered.at(-1);
  if (last === undefined) throw new Error("hook did not render");
  return last.value;
}
