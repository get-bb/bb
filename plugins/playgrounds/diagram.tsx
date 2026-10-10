import { useId } from "react";
import { evaluate, type Block, type Expression, type Values } from "./model.js";

type DiagramBlock = Extract<Block, { type: "diagram" }>;
type Element = DiagramBlock["elements"][number];
export function Diagram({
  block,
  values,
  onChoose,
}: {
  block: DiagramBlock;
  values: Values;
  onChoose: (control: string, value: string | number) => void;
}) {
  const titleId = useId(),
    descriptionId = useId();
  const paint = (p: Element["fill"], fallback: string) =>
    typeof p === "string"
      ? p
      : p
        ? (p.colors.find((c) => c.value === values[p.control])?.color ??
          fallback)
        : fallback;
  return (
    <section className="pg-diagram" aria-labelledby={titleId}>
      <h4 id={titleId}>{block.title}</h4>
      <svg
        viewBox={`0 0 ${block.width} ${block.height}`}
        role="group"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <desc id={descriptionId}>{block.description}</desc>
        {block.elements.map((s, i) => {
          if (s.when && values[s.when.control] !== s.when.equals) return null;
          const fields = [
            s.x,
            s.y,
            s.x2,
            s.y2,
            s.width,
            s.height,
            s.rx,
            s.ry,
            s.opacity,
            s.rotate,
            s.scale,
          ];
          if (
            fields.some((v) => v !== undefined && evaluate(v, values) === null)
          )
            return null;
          const n = (v: Expression | undefined, fallback = 0) =>
            v === undefined ? fallback : evaluate(v, values)!;
          const attrs = {
            fill: paint(s.fill, "none"),
            stroke: paint(s.stroke, "none"),
            strokeWidth: s.strokeWidth ?? 1,
            strokeLinecap: "round" as const,
            strokeLinejoin: "round" as const,
          };
          const transform = `translate(${n(s.x)} ${n(s.y)}) translate(${s.originX ?? 0} ${s.originY ?? 0}) rotate(${n(s.rotate)}) scale(${Math.max(0, Math.min(10, n(s.scale, 1)))}) translate(${-(s.originX ?? 0)} ${-(s.originY ?? 0)})`;
          const choose = s.choose;
          return (
            <g
              key={i}
              className={choose ? "pg-diagram-choice" : undefined}
              transform={transform}
              opacity={Math.max(0, Math.min(1, n(s.opacity, 1)))}
              role={choose ? "button" : undefined}
              tabIndex={choose ? 0 : undefined}
              aria-label={s.label}
              aria-pressed={
                choose ? values[choose.control] === choose.value : undefined
              }
              onClick={
                choose
                  ? () => onChoose(choose.control, choose.value)
                  : undefined
              }
              onKeyDown={
                choose
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onChoose(choose.control, choose.value);
                      }
                    }
                  : undefined
              }
            >
              {s.label && <title>{s.label}</title>}
              {s.kind === "path" && <path {...attrs} d={s.d} />}
              {s.kind === "rect" && (
                <rect
                  {...attrs}
                  width={Math.max(0, n(s.width))}
                  height={Math.max(0, n(s.height))}
                  rx={Math.max(0, n(s.rx))}
                />
              )}
              {s.kind === "ellipse" && (
                <ellipse
                  {...attrs}
                  rx={Math.max(0, n(s.rx))}
                  ry={Math.max(0, n(s.ry, n(s.rx)))}
                />
              )}
              {s.kind === "line" && (
                <line {...attrs} x2={n(s.x2)} y2={n(s.y2)} />
              )}
              {s.kind === "text" && (
                <text
                  {...attrs}
                  fontSize={s.fontSize ?? 16}
                  fontFamily="inherit"
                >
                  {s.text}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </section>
  );
}
