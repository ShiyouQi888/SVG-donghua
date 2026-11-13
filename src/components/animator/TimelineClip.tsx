import {
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { fmtTime, layerClipRange, type Layer } from "@/lib/animator/model";
import { useDoc } from "@/lib/animator/store";

type TimeDisplayMode = "timecode" | "frames";
type TrimEdge = "in" | "out";
type TrimDrag = {
  pointerId: number;
  edge: TrimEdge;
  clientX: number;
  inPoint: number;
  outPoint: number;
};

export function TimelineClip({
  layer,
  duration,
  fps,
  px,
  selected,
  timeDisplayMode,
}: {
  layer: Layer;
  duration: number;
  fps: number;
  px: number;
  selected: boolean;
  timeDisplayMode: TimeDisplayMode;
}) {
  const drag = useRef<TrimDrag | null>(null);
  const setLayerClipRange = useDoc((state) => state.setLayerClipRange);
  const selectLayer = useDoc((state) => state.selectLayer);
  const { inPoint, outPoint } = layerClipRange(layer, duration, fps);
  const left = Math.max(0, Math.round(inPoint * fps) * px / fps);
  const right = Math.min(duration * px, Math.max(left + px / fps, outPoint * px));
  const width = Math.max(px / fps, right - left);
  const format = (time: number) =>
    timeDisplayMode === "frames" ? Math.round(time * fps) + " 帧" : fmtTime(time, fps);
  const label = layer.name + " · 入点 " + format(inPoint) + " · 出点 " + format(outPoint);

  function beginTrim(event: ReactPointerEvent<HTMLButtonElement>, edge: TrimEdge) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    useDoc.getState().beginUndoGroup();
    selectLayer(layer.id);
    drag.current = {
      pointerId: event.pointerId,
      edge,
      clientX: event.clientX,
      inPoint,
      outPoint,
    };
  }

  function moveTrim(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const delta = (event.clientX - active.clientX) / Math.max(1, px);
    const nextTime = Math.max(
      0,
      Math.min(duration, Math.round(((active.edge === "in" ? active.inPoint : active.outPoint) + delta) * fps) / fps),
    );
    if (active.edge === "in") setLayerClipRange(layer.id, nextTime, active.outPoint);
    else setLayerClipRange(layer.id, active.inPoint, nextTime);
  }

  function finishTrim(event: ReactPointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    useDoc.getState().endUndoGroup();
  }

  function resetTrim(
    event: ReactPointerEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>,
    edge: TrimEdge,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (edge === "in") setLayerClipRange(layer.id, 0, outPoint);
    else setLayerClipRange(layer.id, inPoint, duration);
  }

  return (
    <div
      data-layer-clip={layer.id}
      data-clip-in={inPoint}
      data-clip-out={outPoint}
      aria-label={label}
      title={label}
      onPointerDown={(event) => {
        event.stopPropagation();
        selectLayer(layer.id);
      }}
      className={
        "timeline-clip group absolute inset-y-1 flex min-w-0 items-center overflow-hidden rounded border transition-colors " +
        (selected
          ? "border-primary/70 bg-primary/20 text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]"
          : "border-border-strong bg-surface-2/80 text-muted hover:border-primary/40 hover:text-fg")
      }
      style={{ left, width }}
    >
      <span className={"h-full w-1 shrink-0 " + (selected ? "bg-primary" : "bg-border-strong")} />
      <span className="min-w-0 flex-1 truncate px-1.5 font-mono text-[10px] leading-none">
        {layer.name}
      </span>
      <TrimHandle
        edge="in"
        value={inPoint}
        fps={fps}
        format={format}
        beginTrim={beginTrim}
        moveTrim={moveTrim}
        finishTrim={finishTrim}
        resetTrim={resetTrim}
      />
      <TrimHandle
        edge="out"
        value={outPoint}
        fps={fps}
        format={format}
        beginTrim={beginTrim}
        moveTrim={moveTrim}
        finishTrim={finishTrim}
        resetTrim={resetTrim}
      />
    </div>
  );
}

function TrimHandle({
  edge,
  value,
  fps,
  format,
  beginTrim,
  moveTrim,
  finishTrim,
  resetTrim,
}: {
  edge: TrimEdge;
  value: number;
  fps: number;
  format: (time: number) => string;
  beginTrim: (event: ReactPointerEvent<HTMLButtonElement>, edge: TrimEdge) => void;
  moveTrim: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  finishTrim: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  resetTrim: (
    event: ReactPointerEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>,
    edge: TrimEdge,
  ) => void;
}) {
  const start = edge === "in";
  const label = start ? "裁剪片段入点" : "裁剪片段出点";
  return (
    <button
      type="button"
      aria-label={label + " · " + format(value)}
      title={label + "，拖动吸附到 " + fps + " fps 帧位；双击重置"}
      data-clip-edge={edge}
      onPointerDown={(event) => beginTrim(event, edge)}
      onPointerMove={moveTrim}
      onPointerUp={finishTrim}
      onPointerCancel={finishTrim}
      onLostPointerCapture={finishTrim}
      onDoubleClick={(event) => resetTrim(event, edge)}
      className={
        "timeline-clip-trim absolute inset-y-0 z-10 grid w-2 place-items-center bg-primary/70 transition-colors hover:bg-primary " +
        (start ? "left-0 rounded-l-sm" : "right-0 rounded-r-sm")
      }
    >
      <span className="h-2.5 w-px rounded-full bg-white/90" />
    </button>
  );
}
