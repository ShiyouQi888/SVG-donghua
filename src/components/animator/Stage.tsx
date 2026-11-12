import { useRef, useState, type PointerEvent } from "react";
import {
  displayed,
  motionBlurVector,
  numberToColor,
  pose,
  svgTransform,
  type Layer,
} from "@/lib/animator/model";
import { useDoc } from "@/lib/animator/store";

function svgPoint(svg: SVGSVGElement, event: PointerEvent): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

function snapAxis(
  start: number,
  size: number,
  targets: number[],
  threshold: number,
): { delta: number; guide: number } | null {
  const anchors = [start, start + size / 2, start + size];
  let best: { delta: number; guide: number; distance: number } | null = null;
  for (const target of targets) {
    for (const anchor of anchors) {
      const delta = target - anchor;
      const distance = Math.abs(delta);
      if (distance <= threshold && (!best || distance < best.distance)) {
        best = { delta, guide: target, distance };
      }
    }
  }
  return best;
}

function ShapeBody({ layer, time }: { layer: Layer; time: number }) {
  const fill = numberToColor(displayed(layer, "fill", time));
  const stroke = numberToColor(displayed(layer, "stroke", time));
  const strokeWidth = displayed(layer, "strokeWidth", time);
  if (layer.kind === "image") {
    return (
      <image
        href={layer.imageSrc}
        x={layer.x}
        y={layer.y}
        width={layer.w}
        height={layer.h}
        preserveAspectRatio="none"
      />
    );
  }
  if (layer.kind === "circle") {
    const r = Math.min(layer.w, layer.h) / 2;
    return (
      <circle
        cx={layer.x + layer.w / 2}
        cy={layer.y + layer.h / 2}
        r={r}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }
  if (layer.kind === "ellipse") {
    return (
      <ellipse
        cx={layer.x + layer.w / 2}
        cy={layer.y + layer.h / 2}
        rx={layer.w / 2}
        ry={layer.h / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }
  if (layer.kind === "text") {
    return (
      <text
        x={layer.x + layer.w / 2}
        y={layer.y + layer.h / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fontSize={layer.fontSize}
        fontFamily="IBM Plex Sans, sans-serif"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {layer.text}
      </text>
    );
  }
  return (
    <rect
      x={layer.x}
      y={layer.y}
      width={layer.w}
      height={layer.h}
      rx={8}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  );
}

export function Stage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [snapGuides, setSnapGuides] = useState<{ x?: number; y?: number } | null>(null);
  const drag = useRef<{
    id: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    x: number;
    y: number;
  } | null>(null);
  const resize = useRef<{
    id: string;
    sx: number;
    sy: number;
    x: number;
    y: number;
    w: number;
    h: number;
    fontSize: number;
    lockRatio: boolean;
    scaleFontSize: boolean;
    hx: -1 | 0 | 1;
    hy: -1 | 0 | 1;
  } | null>(null);
  const layers = useDoc((s) => s.layers);
  const time = useDoc((s) => s.time);
  const projectWidth = useDoc((s) => s.projectWidth);
  const projectHeight = useDoc((s) => s.projectHeight);
  const duration = useDoc((s) => s.duration);
  const safeArea = useDoc((s) => s.safeArea);
  const snapEnabled = useDoc((s) => s.snapEnabled);
  const motionBlur = useDoc((s) => s.motionBlur);
  const motionBlurStrength = useDoc((s) => s.motionBlurStrength);
  const selectedId = useDoc((s) => s.selectedId);
  const tool = useDoc((s) => s.tool);
  const selectLayer = useDoc((s) => s.selectLayer);
  const addShape = useDoc((s) => s.addShape);
  const moveBy = useDoc((s) => s.moveBy);
  const setPaint = useDoc((s) => s.setPaint);

  const blurByLayer = new Map(
    motionBlur
      ? layers
          .filter((layer) => layer.visible)
          .map(
            (layer) =>
              [layer.id, motionBlurVector(layer, time, duration, motionBlurStrength)] as const,
          )
          .filter(([, blur]) => blur.x > 0.1 || blur.y > 0.1)
      : [],
  );

  return (
    <div className="stage-grid relative min-h-0 flex-1 overflow-hidden">
      <div className="stage-canvas-viewport">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${projectWidth} ${projectHeight}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full touch-none"
          onPointerMove={(event) => {
            const svg = svgRef.current;
            if (!svg) return;
            const point = svgPoint(svg, event);
            const r = resize.current;
            if (r) {
              const dx = point.x - r.sx;
              const dy = point.y - r.sy;
              let w = Math.max(12, r.w + (r.hx < 0 ? -dx : r.hx > 0 ? dx : 0));
              let h = Math.max(12, r.h + (r.hy < 0 ? -dy : r.hy > 0 ? dy : 0));
              if (r.lockRatio) {
                const xMotion = r.hx === 0 ? 0 : Math.abs(dx / r.w);
                const yMotion = r.hy === 0 ? 0 : Math.abs(dy / r.h);
                const factor = xMotion > yMotion ? w / r.w : h / r.h;
                w = Math.max(12, r.w * factor);
                h = Math.max(12, r.h * factor);
              }
              const patch: { x: number; y: number; w: number; h: number; fontSize?: number } = {
                x: r.hx < 0 ? r.x + r.w - w : r.x,
                y: r.hy < 0 ? r.y + r.h - h : r.y,
                w,
                h,
              };
              if (r.scaleFontSize) patch.fontSize = Math.max(8, r.fontSize * (w / r.w));
              setPaint(r.id, patch);
              return;
            }
            const d = drag.current;
            if (!d) return;
            let dx = point.x - d.sx;
            let dy = point.y - d.sy;
            let guideX: number | undefined;
            let guideY: number | undefined;
            if (snapEnabled) {
              const moving = useDoc.getState().layers.find((layer) => layer.id === d.id);
              const matrix = svg.getScreenCTM();
              if (moving && matrix) {
                const threshold = 8 / Math.max(0.001, Math.hypot(matrix.a, matrix.b));
                const others = layers.filter((layer) => layer.visible && layer.id !== d.id);
                const xTargets = [0, projectWidth / 2, projectWidth];
                const yTargets = [0, projectHeight / 2, projectHeight];
                for (const other of others) {
                  const x = displayed(other, "x", time);
                  const y = displayed(other, "y", time);
                  xTargets.push(x, x + other.w / 2, x + other.w);
                  yTargets.push(y, y + other.h / 2, y + other.h);
                }
                const xSnap = snapAxis(d.x + d.ox + dx, moving.w, xTargets, threshold);
                const ySnap = snapAxis(d.y + d.oy + dy, moving.h, yTargets, threshold);
                if (xSnap) {
                  dx += xSnap.delta;
                  guideX = xSnap.guide;
                }
                if (ySnap) {
                  dy += ySnap.delta;
                  guideY = ySnap.guide;
                }
              }
            }
            setSnapGuides(
              guideX === undefined && guideY === undefined ? null : { x: guideX, y: guideY },
            );
            moveBy(d.id, dx, dy, {
              x: d.x,
              y: d.y,
              ox: d.ox,
              oy: d.oy,
            });
          }}
          onPointerUp={() => {
            drag.current = null;
            resize.current = null;
            setSnapGuides(null);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
            resize.current = null;
            setSnapGuides(null);
          }}
          onPointerDown={(event) => {
            const target = event.target as Element;
            const backdrop = target.id === "stage-bg" || target === event.currentTarget;
            if (!backdrop) return;
            if (tool === "select") {
              selectLayer(null);
              return;
            }
            const svg = svgRef.current;
            if (!svg) return;
            const p = svgPoint(svg, event);
            addShape(tool, p.x, p.y);
          }}
        >
          {blurByLayer.size > 0 && (
            <defs>
              {[...blurByLayer].map(([id, blur]) => (
                <filter
                  key={id}
                  id={`motion-blur-${id}`}
                  x="-50%"
                  y="-50%"
                  width="200%"
                  height="200%"
                >
                  <feGaussianBlur stdDeviation={`${blur.x.toFixed(2)} ${blur.y.toFixed(2)}`} />
                </filter>
              ))}
            </defs>
          )}
          <rect
            id="stage-bg"
            x={0.5}
            y={0.5}
            width={Math.max(0, projectWidth - 1)}
            height={Math.max(0, projectHeight - 1)}
            className="stage-canvas-boundary"
          />
          {layers.map((layer) => {
            const p = pose(layer, time);
            const selected = layer.id === selectedId;
            const allHandles = [
              { id: "nw", x: layer.x - 4, y: layer.y - 4, hx: -1, hy: -1, cursor: "nwse-resize" },
              {
                id: "n",
                x: layer.x + layer.w / 2 - 4,
                y: layer.y - 4,
                hx: 0,
                hy: -1,
                cursor: "ns-resize",
              },
              {
                id: "ne",
                x: layer.x + layer.w - 4,
                y: layer.y - 4,
                hx: 1,
                hy: -1,
                cursor: "nesw-resize",
              },
              {
                id: "e",
                x: layer.x + layer.w - 4,
                y: layer.y + layer.h / 2 - 4,
                hx: 1,
                hy: 0,
                cursor: "ew-resize",
              },
              {
                id: "se",
                x: layer.x + layer.w - 4,
                y: layer.y + layer.h - 4,
                hx: 1,
                hy: 1,
                cursor: "nwse-resize",
              },
              {
                id: "s",
                x: layer.x + layer.w / 2 - 4,
                y: layer.y + layer.h - 4,
                hx: 0,
                hy: 1,
                cursor: "ns-resize",
              },
              {
                id: "sw",
                x: layer.x - 4,
                y: layer.y + layer.h - 4,
                hx: -1,
                hy: 1,
                cursor: "nesw-resize",
              },
              {
                id: "w",
                x: layer.x - 4,
                y: layer.y + layer.h / 2 - 4,
                hx: -1,
                hy: 0,
                cursor: "ew-resize",
              },
            ] as const;
            const handles =
              layer.kind === "rect" || layer.kind === "ellipse"
                ? allHandles
                : allHandles.filter((handle) => handle.hx !== 0 && handle.hy !== 0);
            return (
              <g
                key={layer.id}
                transform={svgTransform(layer, time)}
                style={{ pointerEvents: layer.visible ? "auto" : "none" }}
                onPointerDown={(event) => {
                  if (tool !== "select") return;
                  event.stopPropagation();
                  const svg = svgRef.current;
                  if (!svg) return;
                  selectLayer(layer.id);
                  const point = svgPoint(svg, event);
                  const live = useDoc.getState().layers.find((l) => l.id === layer.id);
                  if (!live) return;
                  const now = useDoc.getState().time;
                  drag.current = {
                    id: layer.id,
                    sx: point.x,
                    sy: point.y,
                    x: live.x,
                    y: live.y,
                    ox: pose(live, now).dx,
                    oy: pose(live, now).dy,
                  };
                  svg.setPointerCapture(event.pointerId);
                }}
              >
                <g
                  opacity={layer.visible ? p.opacity : 0}
                  filter={blurByLayer.has(layer.id) ? `url(#motion-blur-${layer.id})` : undefined}
                >
                  <ShapeBody layer={layer} time={time} />
                </g>
                {selected && (
                  <rect
                    x={layer.x - 4}
                    y={layer.y - 4}
                    width={layer.w + 8}
                    height={layer.h + 8}
                    fill="none"
                    stroke="var(--color-primary)"
                    strokeDasharray="5 3"
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                )}
                {selected && (
                  <g>
                    {handles.map((handle) => (
                      <rect
                        key={handle.id}
                        data-resize-handle={handle.id}
                        className="stage-resize-handle"
                        x={handle.x}
                        y={handle.y}
                        width={8}
                        height={8}
                        rx={1.5}
                        style={{ cursor: handle.cursor, touchAction: "none" }}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          if (tool !== "select") return;
                          const svg = svgRef.current;
                          if (!svg) return;
                          selectLayer(layer.id);
                          const point = svgPoint(svg, event);
                          resize.current = {
                            id: layer.id,
                            sx: point.x,
                            sy: point.y,
                            x: layer.x,
                            y: layer.y,
                            w: layer.w,
                            h: layer.h,
                            fontSize: layer.fontSize,
                            lockRatio:
                              layer.kind === "circle" ||
                              layer.kind === "text" ||
                              layer.kind === "image",
                            scaleFontSize: layer.kind === "text",
                            hx: handle.hx as -1 | 0 | 1,
                            hy: handle.hy as -1 | 0 | 1,
                          };
                          svg.setPointerCapture(event.pointerId);
                        }}
                      />
                    ))}
                  </g>
                )}
              </g>
            );
          })}
          {safeArea && (
            <g className="pointer-events-none" aria-hidden="true">
              <rect
                x={projectWidth * 0.05}
                y={projectHeight * 0.05}
                width={projectWidth * 0.9}
                height={projectHeight * 0.9}
                className="stage-safe-area stage-safe-area-action"
              />
              <rect
                x={projectWidth * 0.1}
                y={projectHeight * 0.1}
                width={projectWidth * 0.8}
                height={projectHeight * 0.8}
                className="stage-safe-area stage-safe-area-title"
              />
            </g>
          )}
          {snapGuides?.x !== undefined && (
            <line
              x1={snapGuides.x}
              x2={snapGuides.x}
              y1={0}
              y2={projectHeight}
              className="stage-snap-guide"
              pointerEvents="none"
            />
          )}
          {snapGuides?.y !== undefined && (
            <line
              x1={0}
              x2={projectWidth}
              y1={snapGuides.y}
              y2={snapGuides.y}
              className="stage-snap-guide"
              pointerEvents="none"
            />
          )}
        </svg>
      </div>
      {layers.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-lg font-medium text-fg">画布是空的</p>
            <p className="mt-1 text-sm text-muted">从顶栏选一个形状，点在画布上放下</p>
          </div>
        </div>
      )}
    </div>
  );
}
