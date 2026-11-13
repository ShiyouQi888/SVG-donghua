import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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
type ClipDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  lastAppliedFrames: number;
  mode: "pending" | "time" | "stack";
  lastRowTarget: string | null;
};

export function TimelineClip({
  layer,
  duration,
  fps,
  px,
  selected,
  locked = Boolean(layer.locked),
  timeDisplayMode,
}: {
  layer: Layer;
  duration: number;
  fps: number;
  px: number;
  selected: boolean;
  locked?: boolean;
  timeDisplayMode: TimeDisplayMode;
}) {
  const trimDrag = useRef<TrimDrag | null>(null);
  const clipDrag = useRef<ClipDrag | null>(null);
  const [dragging, setDragging] = useState(false);
  const setLayerClipRange = useDoc((state) => state.setLayerClipRange);
  const moveLayerClip = useDoc((state) => state.moveLayerClip);
  const moveLayerToRow = useDoc((state) => state.moveLayerToRow);
  const moveLayer = useDoc((state) => state.moveLayer);
  const selectLayer = useDoc((state) => state.selectLayer);
  const { inPoint, outPoint } = layerClipRange(layer, duration, fps);
  const frame = 1 / fps;
  const visibleIn = Math.min(duration - frame, Math.max(0, inPoint));
  const visibleOut = Math.min(duration, Math.max(visibleIn + frame, outPoint));
  const left = Math.round(visibleIn * px);
  const width = Math.max(px * frame, (visibleOut - visibleIn) * px);
  const format = (time: number) =>
    timeDisplayMode === "frames" ? Math.round(time * fps) + " 帧" : fmtTime(time, fps);
  const label = layer.name + " · 入点 " + format(inPoint) + " · 出点 " + format(outPoint);

  function beginTrim(event: ReactPointerEvent<HTMLButtonElement>, edge: TrimEdge) {
    event.preventDefault();
    event.stopPropagation();
    if (locked) return;
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    selectLayer(layer.id);
    useDoc.getState().beginUndoGroup();
    trimDrag.current = {
      pointerId: event.pointerId,
      edge,
      clientX: event.clientX,
      inPoint: visibleIn,
      outPoint: visibleOut,
    };
  }

  function moveTrim(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = trimDrag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const delta = (event.clientX - active.clientX) / Math.max(1, px);
    const start = active.edge === "in" ? active.inPoint : active.outPoint;
    const nextTime = Math.max(0, Math.min(duration, Math.round((start + delta) * fps) / fps));
    if (active.edge === "in") setLayerClipRange(layer.id, nextTime, active.outPoint);
    else setLayerClipRange(layer.id, active.inPoint, nextTime);
  }

  function finishTrim(event: ReactPointerEvent<HTMLButtonElement>) {
    if (trimDrag.current?.pointerId !== event.pointerId) return;
    trimDrag.current = null;
    useDoc.getState().endUndoGroup();
  }

  function beginMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (locked) {
      event.stopPropagation();
      return;
    }
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    selectLayer(layer.id);
    useDoc.getState().beginUndoGroup();
    clipDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastAppliedFrames: 0,
      mode: "pending",
      lastRowTarget: null,
    };
  }

  function findTargetRow(clientX: number, clientY: number) {
    const direct = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-layer-row-id]");
    if (direct && direct.dataset.layerRowId !== layer.id) return direct;
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-layer-row-id]"));
    return rows.find((row) => {
      const rect = row.getBoundingClientRect();
      return row.dataset.layerRowId !== layer.id && clientY >= rect.top && clientY <= rect.bottom;
    }) ?? null;
  }

  function moveClip(event: ReactPointerEvent<HTMLDivElement>) {
    const active = clipDrag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (active.mode === "pending") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
      active.mode = Math.abs(dy) > Math.abs(dx) ? "stack" : "time";
      setDragging(true);
    }

    if (active.mode === "time") {
      const totalFrames = Math.round((event.clientX - active.startX) / Math.max(1, px) * fps);
      const deltaFrames = totalFrames - active.lastAppliedFrames;
      if (deltaFrames !== 0) moveLayerClip(layer.id, deltaFrames);
      active.lastAppliedFrames = totalFrames;
      return;
    }

    const target = findTargetRow(event.clientX, event.clientY);
    const targetId = target?.dataset.layerRowId;
    if (!target || !targetId || targetId === layer.id) return;
    const rect = target.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    const rowTarget = `${targetId}:${placement}`;
    if (rowTarget === active.lastRowTarget) return;
    moveLayerToRow(layer.id, targetId, placement);
    active.lastRowTarget = rowTarget;
  }

  function finishMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (clipDrag.current?.pointerId !== event.pointerId) return;
    clipDrag.current = null;
    setDragging(false);
    useDoc.getState().endUndoGroup();
  }

  function resetTrim(
    event: ReactPointerEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>,
    edge: TrimEdge,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const offset = layer.timelineOffset ?? 0;
    if (edge === "in") setLayerClipRange(layer.id, offset, outPoint);
    else setLayerClipRange(layer.id, inPoint, offset + duration);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (locked) return;
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft") moveLayerClip(layer.id, -1);
    else if (event.key === "ArrowRight") moveLayerClip(layer.id, 1);
    else if (event.key === "ArrowUp") moveLayer(layer.id, "front");
    else if (event.key === "ArrowDown") moveLayer(layer.id, "backward");
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      data-layer-clip={layer.id}
      data-clip-in={inPoint}
      data-clip-out={outPoint}
      data-dragging={dragging}
      aria-label={label + " · 拖动移动时间，纵向拖动调整层级"}
      aria-roledescription="可移动图层片段"
      role="group"
      tabIndex={0}
      title={label + " · 横向拖动移动时间，长度不变且在项目边界停止；占满项目的片段需先裁剪；纵向拖动调整层级"}
      onKeyDown={onKeyDown}
      onPointerDown={beginMove}
      onPointerMove={moveClip}
      onPointerUp={finishMove}
      onPointerCancel={finishMove}
      onLostPointerCapture={finishMove}
      className={
        "timeline-clip group absolute inset-y-1 flex min-w-0 select-none touch-none items-center overflow-hidden rounded border transition-colors " +
        (dragging
          ? "z-20 cursor-grabbing border-primary bg-primary/25 text-fg opacity-95 shadow-lg ring-1 ring-primary/70"
          : selected
            ? "cursor-grab border-primary/70 bg-primary/20 text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] hover:bg-primary/25"
            : "cursor-grab border-border-strong bg-surface-2/80 text-muted hover:border-primary/50 hover:bg-surface-2 hover:text-fg")
      }
      style={{ left, width }}
    >
      <span className={"h-full w-1 shrink-0 " + (selected ? "bg-primary" : "bg-border-strong")} />
      <span className="min-w-0 flex-1 truncate px-1.5 font-mono text-[10px] leading-none">
        {layer.name}
      </span>
      <TrimHandle
        edge="in"
        value={visibleIn}
        fps={fps}
        format={format}
        beginTrim={beginTrim}
        moveTrim={moveTrim}
        finishTrim={finishTrim}
        resetTrim={resetTrim}
      />
      <TrimHandle
        edge="out"
        value={visibleOut}
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
