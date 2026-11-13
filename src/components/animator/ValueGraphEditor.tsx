import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChartNoAxesCombined, LockKeyhole } from "lucide-react";
import {
  DEFAULT_BEZIER,
  PROP_LABEL,
  displayed,
  snapTime,
  type Interp,
  type Layer,
  type PropKey,
} from "@/lib/animator/model";
import { useDoc } from "@/lib/animator/store";

const GRAPH_PROPS: PropKey[] = ["opacity", "x", "y", "rotate", "scale", "scaleY", "strokeWidth"];
const INTERP_COLORS: Record<Interp, string> = {
  linear: "#f2b01e",
  ease: "#33bd9d",
  bezier: "#9360e8",
  hold: "#f0884d",
};
const GRAPH_HEIGHT = 260;
const PLOT = { top: 22, right: 22, bottom: 34 };
type BezierHandle = "p1" | "p2";

function formatValue(prop: PropKey, value: number) {
  if (prop === "opacity") return `${(value * 100).toFixed(0)}%`;
  if (prop === "scale" || prop === "scaleY") return `${(value * 100).toFixed(0)}%`;
  if (prop === "strokeWidth") return `${value.toFixed(1)} px`;
  return value.toFixed(1);
}

function graphValueBounds(prop: PropKey, layer: Layer, sampledValues: number[], fps: number) {
  const values = [
    ...sampledValues,
    ...layer.tracks[prop].map((key) => displayed(layer, prop, key.t, fps)),
  ];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (prop === "opacity") {
    min = 0;
    max = 1;
  } else if (prop === "scale" || prop === "scaleY" || prop === "strokeWidth") {
    min = Math.max(0, min - Math.max(0.2, (max - min) * 0.15));
    max += Math.max(0.2, (max - min) * 0.15);
  } else {
    const pad = Math.max(1, (max - min) * 0.15);
    min -= pad;
    max += pad;
  }
  if (max - min < 1e-6) max = min + 1;
  return { min, max };
}

export function ValueGraphEditor({
  layer,
  duration,
  fps,
  width,
  labelWidth,
}: {
  layer?: Layer;
  duration: number;
  fps: number;
  width: number;
  labelWidth: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null);
  const bezierDragRef = useRef<{
    id: string;
    pointerId: number;
    handle: BezierHandle;
    startTime: number;
    endTime: number;
  } | null>(null);
  const [graphProp, setGraphProp] = useState<PropKey | null>(null);
  const currentKey = useDoc((state) => state.selectedKey);
  const selectKey = useDoc((state) => state.selectKey);
  const currentTime = useDoc((state) => state.time);
  const patchKey = useDoc((state) => state.patchKey);
  const beginUndoGroup = useDoc((state) => state.beginUndoGroup);
  const endUndoGroup = useDoc((state) => state.endUndoGroup);
  useEffect(() => {
    if (currentKey && GRAPH_PROPS.includes(currentKey.prop)) setGraphProp(currentKey.prop);
  }, [currentKey?.id, currentKey?.layerId, currentKey?.prop]);
  const selectedProp =
    graphProp ?? (currentKey && GRAPH_PROPS.includes(currentKey.prop) ? currentKey.prop : "x");
  const plotLeft = Math.max(80, labelWidth + 12);
  const plotWidth = Math.max(220, width - plotLeft - PLOT.right);
  const valueSamples = useMemo(() => {
    if (!layer) return [];
    const sampleCount = Math.max(64, Math.min(1200, Math.ceil(duration * Math.max(fps, 24))));
    return Array.from({ length: sampleCount + 1 }, (_, index) => {
      const time = (duration * index) / sampleCount;
      return { time, value: displayed(layer, selectedProp, time, fps) };
    });
  }, [duration, fps, layer, selectedProp]);
  const { min, max } = useMemo(() => {
    if (!layer) return { min: 0, max: 1 };
    return graphValueBounds(
      selectedProp,
      layer,
      valueSamples.map((point) => point.value),
      fps,
    );
  }, [fps, layer, selectedProp, valueSamples]);
  const plotHeight = GRAPH_HEIGHT - PLOT.top - PLOT.bottom;
  const yFor = (value: number) => PLOT.top + ((max - value) / (max - min)) * plotHeight;
  const xFor = (time: number) => plotLeft + (time / Math.max(0.001, duration)) * plotWidth;
  const track = useMemo(
    () => (layer ? [...layer.tracks[selectedProp]].sort((a, b) => a.t - b.t) : []),
    [layer, selectedProp],
  );
  const bezierSegments = useMemo(() => {
    if (!layer) return [];
    return track.flatMap((key, index) => {
      const next = track[index + 1];
      if (key.interp !== "bezier" || !next) return [];
      const span = next.t - key.t;
      if (span <= 0) return [];
      const startValue = displayed(layer, selectedProp, key.t, fps);
      const endValue = displayed(layer, selectedProp, next.t, fps);
      const curve = key.bezier ?? DEFAULT_BEZIER;
      const valueAtProgress = (progress: number) => startValue + (endValue - startValue) * progress;
      return [
        {
          key,
          next,
          start: { x: xFor(key.t), y: yFor(startValue) },
          end: { x: xFor(next.t), y: yFor(endValue) },
          p1: {
            x: xFor(key.t + span * curve.x1),
            y: yFor(valueAtProgress(curve.y1)),
          },
          p2: {
            x: xFor(key.t + span * curve.x2),
            y: yFor(valueAtProgress(curve.y2)),
          },
        },
      ];
    });
  }, [fps, layer, selectedProp, track, duration, plotLeft, plotWidth, plotHeight, min, max]);
  const curveSegments = useMemo(() => {
    if (!layer || duration <= 0) return [];
    const boundaries = [0, ...track.map((key) => Math.min(duration, Math.max(0, key.t))), duration]
      .sort((a, b) => a - b)
      .filter((time, index, all) => index === 0 || time - all[index - 1] > 1e-8);
    return boundaries.slice(0, -1).map((start, index) => {
      const end = boundaries[index + 1];
      const interpolation = track.filter((key) => key.t <= start + 1e-8).at(-1)?.interp ?? "linear";
      const interiorTimes = valueSamples
        .filter((point) => point.time > start + 1e-8 && point.time < end - 1e-8)
        .map((point) => point.time);
      const path = [start, ...interiorTimes, end]
        .map((time, pointIndex) => {
          const value = displayed(layer, selectedProp, time, fps);
          return `${pointIndex === 0 ? "M" : "L"} ${xFor(time).toFixed(2)} ${yFor(value).toFixed(2)}`;
        })
        .join(" ");
      return { id: `${start}-${end}`, interpolation, path };
    });
  }, [
    duration,
    fps,
    layer,
    max,
    min,
    plotLeft,
    plotWidth,
    plotHeight,
    selectedProp,
    track,
    valueSamples,
  ]);

  const updateKeyFromPointer = (event: ReactPointerEvent<SVGSVGElement | SVGCircleElement>) => {
    const active = dragRef.current;
    const svg = svgRef.current;
    const key = track.find((item) => item.id === active?.id);
    if (!active || active.pointerId !== event.pointerId || !svg || !key || !layer) return;
    const rect = svg.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * width;
    const localY = ((event.clientY - rect.top) / Math.max(1, rect.height)) * GRAPH_HEIGHT;
    const time = Math.min(duration, Math.max(0, ((localX - plotLeft) / plotWidth) * duration));
    const value = max - ((localY - PLOT.top) / plotHeight) * (max - min);
    const boundedValue =
      selectedProp === "opacity"
        ? Math.min(1, Math.max(0, value))
        : selectedProp === "scale" || selectedProp === "scaleY" || selectedProp === "strokeWidth"
          ? Math.max(0, value)
          : value;
    const trackValue =
      selectedProp === "x"
        ? boundedValue - layer.x
        : selectedProp === "y"
          ? boundedValue - layer.y
          : boundedValue;
    patchKey(layer.id, selectedProp, key.id, {
      t: snapTime(time, duration, fps),
      v: trackValue,
    });
  };

  const updateBezierFromPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = bezierDragRef.current;
    const svg = svgRef.current;
    const key = track.find((item) => item.id === active?.id);
    if (!active || active.pointerId !== event.pointerId || !svg || !key || !layer) return;
    const rect = svg.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * width;
    const localY = ((event.clientY - rect.top) / Math.max(1, rect.height)) * GRAPH_HEIGHT;
    const span = active.endTime - active.startTime;
    if (span <= 0) return;
    const time = Math.min(
      active.endTime,
      Math.max(active.startTime, ((localX - plotLeft) / plotWidth) * duration),
    );
    const value = max - ((localY - PLOT.top) / plotHeight) * (max - min);
    const startValue = displayed(layer, selectedProp, active.startTime, fps);
    const endValue = displayed(layer, selectedProp, active.endTime, fps);
    const progress =
      Math.abs(endValue - startValue) < 1e-8
        ? (key.bezier ?? DEFAULT_BEZIER)[active.handle === "p1" ? "y1" : "y2"]
        : Math.min(1, Math.max(0, (value - startValue) / (endValue - startValue)));
    const bezier = { ...(key.bezier ?? DEFAULT_BEZIER) };
    if (active.handle === "p1") {
      bezier.x1 = (time - active.startTime) / span;
      bezier.y1 = progress;
    } else {
      bezier.x2 = (time - active.startTime) / span;
      bezier.y2 = progress;
    }
    patchKey(layer.id, selectedProp, key.id, { bezier });
  };

  return (
    <section
      aria-label="数值曲线编辑器"
      className="border-b border-border bg-[#151a22]"
      style={{ width }}
    >
      <div className="flex min-h-9 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
          <ChartNoAxesCombined className="size-3.5 text-primary" />
          曲线编辑器
        </span>
        <span className="h-4 w-px bg-border" />
        {layer ? (
          <>
            <span className="max-w-48 truncate text-[11px] text-muted" title={layer.name}>
              {layer.name}
            </span>
            <select
              aria-label="曲线属性"
              value={selectedProp}
              onChange={(event) => {
                const nextProp = event.target.value as PropKey;
                setGraphProp(nextProp);
                const nextTrack = layer.tracks[nextProp];
                const nearest = nextTrack.reduce<(typeof nextTrack)[number] | null>((best, key) => {
                  if (!best || Math.abs(key.t - currentTime) < Math.abs(best.t - currentTime))
                    return key;
                  return best;
                }, null);
                if (nearest) selectKey({ layerId: layer.id, prop: nextProp, id: nearest.id });
                else selectKey(null);
              }}
              className="h-6 rounded border border-border bg-surface-2 px-1.5 text-[10px] text-fg"
            >
              {GRAPH_PROPS.map((prop) => (
                <option key={prop} value={prop}>
                  {PROP_LABEL[prop]}
                </option>
              ))}
            </select>
            <span className="ml-auto font-mono text-[10px] text-muted">
              {track.length} 个关键帧 · Y {formatValue(selectedProp, min)} —{" "}
              {formatValue(selectedProp, max)}
            </span>
          </>
        ) : (
          <span className="text-[11px] text-muted">先选择一个图层以查看数值曲线</span>
        )}
      </div>

      {layer ? (
        <svg
          ref={svgRef}
          role="img"
          aria-label={`${layer.name}的${PROP_LABEL[selectedProp]}曲线`}
          viewBox={`0 0 ${width} ${GRAPH_HEIGHT}`}
          className="block h-[260px] w-full touch-none"
          onPointerMove={(event) => {
            const bezierDrag = bezierDragRef.current;
            const keyDrag = dragRef.current;
            if (bezierDrag && bezierDrag.pointerId === event.pointerId) {
              updateBezierFromPointer(event);
            } else if (keyDrag && keyDrag.pointerId === event.pointerId) {
              updateKeyFromPointer(event);
            }
          }}
          onPointerUp={(event) => {
            if (bezierDragRef.current?.pointerId === event.pointerId) {
              bezierDragRef.current = null;
              endUndoGroup();
            } else if (dragRef.current?.pointerId === event.pointerId) {
              dragRef.current = null;
              endUndoGroup();
            } else {
              return;
            }
          }}
          onPointerCancel={(event) => {
            if (
              bezierDragRef.current?.pointerId === event.pointerId ||
              dragRef.current?.pointerId === event.pointerId
            ) {
              bezierDragRef.current = null;
              dragRef.current = null;
              endUndoGroup();
            }
          }}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const y = PLOT.top + fraction * plotHeight;
            const value = max - fraction * (max - min);
            return (
              <g key={fraction}>
                <line
                  x1={plotLeft}
                  x2={plotLeft + plotWidth}
                  y1={y}
                  y2={y}
                  stroke="rgb(255 255 255 / 8%)"
                  strokeDasharray={fraction === 1 ? undefined : "2 5"}
                />
                <text
                  x={plotLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  fill="rgb(190 202 220 / 70%)"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {formatValue(selectedProp, value)}
                </text>
              </g>
            );
          })}
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const x = plotLeft + fraction * plotWidth;
            const time = duration * fraction;
            return (
              <g key={fraction}>
                <line
                  x1={x}
                  x2={x}
                  y1={PLOT.top}
                  y2={PLOT.top + plotHeight}
                  stroke="rgb(255 255 255 / 7%)"
                />
                <text
                  x={x}
                  y={GRAPH_HEIGHT - 10}
                  textAnchor={fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"}
                  fill="rgb(190 202 220 / 66%)"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {time.toFixed(time < 10 ? 1 : 0)}s
                </text>
              </g>
            );
          })}
          {curveSegments.map((segment) => (
            <path
              key={segment.id}
              d={segment.path}
              fill="none"
              stroke={INTERP_COLORS[segment.interpolation]}
              strokeWidth="2"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {bezierSegments.map((segment) => (
            <g key={`bezier-${segment.key.id}`}>
              <path
                d={`M ${segment.start.x} ${segment.start.y} L ${segment.p1.x} ${segment.p1.y} M ${segment.end.x} ${segment.end.y} L ${segment.p2.x} ${segment.p2.y}`}
                fill="none"
                stroke={INTERP_COLORS.bezier}
                strokeDasharray="3 3"
                strokeWidth="1.25"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
              {(
                [
                  ["p1", segment.p1],
                  ["p2", segment.p2],
                ] as const
              ).map(([handle, point]) => (
                <circle
                  key={handle}
                  data-bezier-handle={handle}
                  data-key-id={segment.key.id}
                  cx={point.x}
                  cy={point.y}
                  r="7"
                  role="button"
                  aria-label={`${PROP_LABEL[selectedProp]}贝塞尔 ${handle.toUpperCase()} 手柄`}
                  fill={INTERP_COLORS.bezier}
                  stroke="#151a22"
                  strokeWidth="2"
                  className={
                    layer.locked
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-grab active:cursor-grabbing"
                  }
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    selectKey({ layerId: layer.id, prop: selectedProp, id: segment.key.id });
                    if (layer.locked) return;
                    bezierDragRef.current = {
                      id: segment.key.id,
                      pointerId: event.pointerId,
                      handle,
                      startTime: segment.key.t,
                      endTime: segment.next.t,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                    beginUndoGroup();
                  }}
                >
                  <title>{`贝塞尔 ${handle.toUpperCase()} · 拖动调整缓动`}</title>
                </circle>
              ))}
            </g>
          ))}
          {track.map((key) => {
            const selected = currentKey?.id === key.id && currentKey.layerId === layer.id;
            const value = displayed(layer, selectedProp, key.t, fps);
            return (
              <circle
                key={key.id}
                cx={xFor(key.t)}
                cy={yFor(value)}
                r={selected ? 6 : 4.5}
                fill={selected ? "#f2b01e" : INTERP_COLORS[key.interp]}
                stroke="#11151c"
                strokeWidth="2"
                className={
                  layer.locked
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-move hover:brightness-125"
                }
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  selectKey({ layerId: layer.id, prop: selectedProp, id: key.id });
                  if (layer.locked) return;
                  dragRef.current = { id: key.id, pointerId: event.pointerId };
                  event.currentTarget.setPointerCapture(event.pointerId);
                  beginUndoGroup();
                }}
              >
                <title>{`${formatValue(selectedProp, value)} · ${key.t.toFixed(3)}s · ${key.interp}`}</title>
              </circle>
            );
          })}
          {layer.locked && (
            <g transform={`translate(${plotLeft + plotWidth - 18} 6)`}>
              <LockKeyhole size={12} color="#9aa7ba" />
            </g>
          )}
        </svg>
      ) : (
        <div className="grid h-48 place-items-center text-xs text-muted">暂无图层曲线</div>
      )}
    </section>
  );
}
