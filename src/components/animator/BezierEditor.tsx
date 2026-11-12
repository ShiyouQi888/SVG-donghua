import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { BezierCurve } from "@/lib/animator/model";

type Handle = "p1" | "p2";

export function BezierEditor({
  curve,
  onChange,
}: {
  curve: BezierCurve;
  onChange: (curve: BezierCurve) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<Handle | null>(null);
  const p1 = { x: curve.x1 * 100, y: (1 - curve.y1) * 100 };
  const p2 = { x: curve.x2 * 100, y: (1 - curve.y2) * 100 };

  function updatePoint(event: ReactPointerEvent<SVGSVGElement>, handle: Handle) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const x = clamp((event.clientX - rect.left) / rect.width);
    const y = clamp(1 - (event.clientY - rect.top) / rect.height);
    onChange(handle === "p1" ? { ...curve, x1: x, y1: y } : { ...curve, x2: x, y2: y });
  }

  function updateValue(handle: Handle, axis: "x" | "y", value: number) {
    const field = `${axis}${handle === "p1" ? "1" : "2"}` as keyof BezierCurve;
    onChange({ ...curve, [field]: clamp(value) });
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-bg/50 p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-fg">贝塞尔曲线</span>
        <span className="font-mono text-xs text-muted">P1 → P2</span>
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="贝塞尔缓动曲线，拖动控制点调整曲线"
        className="bezier-graph h-32 w-full overflow-visible rounded border border-border bg-surface"
        onPointerDown={(event) => {
          const handle = (event.target as SVGElement).dataset.handle as Handle | undefined;
          if (!handle) return;
          dragging.current = handle;
          event.currentTarget.setPointerCapture(event.pointerId);
          updatePoint(event, handle);
        }}
        onPointerMove={(event) => {
          if (dragging.current) updatePoint(event, dragging.current);
        }}
        onPointerUp={() => {
          dragging.current = null;
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
      >
        <path d="M 0 50 H 100 M 50 0 V 100" className="bezier-grid" />
        <path d="M 0 100 L 100 0" className="bezier-guide" />
        <path d={`M 0 100 C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, 100 0`} className="bezier-curve" />
        <path
          d={`M 0 100 L ${p1.x} ${p1.y} M 100 0 L ${p2.x} ${p2.y}`}
          className="bezier-handle-line"
        />
        <circle data-handle="p1" cx={p1.x} cy={p1.y} r="4.5" className="bezier-handle" />
        <circle data-handle="p2" cx={p2.x} cy={p2.y} r="4.5" className="bezier-handle" />
      </svg>

      <div className="grid grid-cols-2 gap-2">
        <ControlPoint
          label="P1"
          x={curve.x1}
          y={curve.y1}
          onChange={(axis, value) => updateValue("p1", axis, value)}
        />
        <ControlPoint
          label="P2"
          x={curve.x2}
          y={curve.y2}
          onChange={(axis, value) => updateValue("p2", axis, value)}
        />
      </div>
      <p className="text-xs leading-5 text-muted">拖动图上的控制点，或输入 0–1 数值微调。</p>
    </div>
  );
}

function ControlPoint({
  label,
  x,
  y,
  onChange,
}: {
  label: string;
  x: number;
  y: number;
  onChange: (axis: "x" | "y", value: number) => void;
}) {
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="text-xs font-medium text-muted">{label}</legend>
      <div className="grid grid-cols-2 gap-1">
        <label className="flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5">
          <span className="font-mono text-xs text-muted">X</span>
          <input
            aria-label={`${label} X`}
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={x.toFixed(2)}
            onChange={(event) => onChange("x", Number(event.target.value))}
            className="w-full min-w-0 bg-transparent py-1 font-mono text-xs text-fg outline-none"
          />
        </label>
        <label className="flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5">
          <span className="font-mono text-xs text-muted">Y</span>
          <input
            aria-label={`${label} Y`}
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={y.toFixed(2)}
            onChange={(event) => onChange("y", Number(event.target.value))}
            className="w-full min-w-0 bg-transparent py-1 font-mono text-xs text-fg outline-none"
          />
        </label>
      </div>
    </fieldset>
  );
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
