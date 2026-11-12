import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  displayed,
  keyNear,
  layerPathData,
  motionBlurVector,
  numberToColor,
  pose,
  starPathData,
  svgTransform,
  vectorPathData,
  type DrawShapeKind,
  type Layer,
  type MotionTangent,
  type VectorPathPoint,
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

type Drawing = {
  kind: DrawShapeKind;
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  endX: number;
  endY: number;
};

type MotionControl = {
  start: { x: number; y: number };
  end: { x: number; y: number };
  out: { x: number; y: number };
  in: { x: number; y: number };
  outKeyId: string;
  inKeyId: string;
};

type MotionHandleDrag = {
  id: string;
  keyId: string;
  side: "in" | "out";
  sx: number;
  sy: number;
  offset: MotionTangent;
};

type PathPointDrag = {
  id: string;
  index: number;
  side: "anchor" | "in" | "out";
  sx: number;
  sy: number;
  startPoint: VectorPathPoint;
  group: SVGGElement;
};

function svgPointInGroup(group: SVGGElement, event: PointerEvent): { x: number; y: number } {
  const svg = group.ownerSVGElement;
  const ctm = group.getScreenCTM();
  if (!svg || !ctm) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

function drawingBounds(drawing: Drawing, clampToMinimum = false) {
  let endX = drawing.endX;
  let endY = drawing.endY;
  if (drawing.kind === "circle") {
    const size = Math.max(Math.abs(endX - drawing.x), Math.abs(endY - drawing.y));
    endX = drawing.x + Math.sign(endX - drawing.x || 1) * size;
    endY = drawing.y + Math.sign(endY - drawing.y || 1) * size;
  }
  const width = Math.abs(endX - drawing.x);
  const height = Math.abs(endY - drawing.y);
  const min = clampToMinimum ? 4 : 1;
  return {
    x: Math.min(drawing.x, endX),
    y: Math.min(drawing.y, endY),
    w: Math.max(min, width),
    h: Math.max(min, height),
  };
}

function pathPoint(x: number, y: number): VectorPathPoint {
  return { x, y, inX: x, inY: y, outX: x, outY: y };
}

function ShapeBody({ layer, time }: { layer: Layer; time: number }) {
  const fill =
    layer.fill === "none" && layer.tracks.fill.length === 0
      ? "none"
      : numberToColor(displayed(layer, "fill", time));
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
  if (layer.kind === "star") {
    return (
      <path
        d={starPathData(layer.x, layer.y, layer.w, layer.h)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    );
  }
  if (layer.kind === "path") {
    return (
      <path
        d={layerPathData(layer)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
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
        fontWeight={layer.fontWeight ?? 600}
        fontFamily="IBM Plex Sans, Source Han Sans SC, sans-serif"
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
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const drawingRef = useRef<Drawing | null>(null);
  const [penPoints, setPenPointsState] = useState<VectorPathPoint[]>([]);
  const penPointsRef = useRef<VectorPathPoint[]>([]);
  const [penHover, setPenHover] = useState<{ x: number; y: number } | null>(null);
  const penAnchorDrag = useRef<{ index: number; sx: number; sy: number } | null>(null);
  const motionHandleDrag = useRef<MotionHandleDrag | null>(null);
  const pathPointDrag = useRef<PathPointDrag | null>(null);
  const groupedPointer = useRef(false);
  const previousTool = useRef<"select" | "pen" | DrawShapeKind>("select");
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
    scaleX: number;
    scaleY: number;
    rotate: number;
    dx: number;
    dy: number;
    fontSize: number;
    lockRatio: boolean;
    scaleFontSize: boolean;
    scaleAnimated: boolean;
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
  const addPath = useDoc((s) => s.addPath);
  const setTool = useDoc((s) => s.setTool);
  const moveBy = useDoc((s) => s.moveBy);
  const setPaint = useDoc((s) => s.setPaint);
  const setDisplayed = useDoc((s) => s.setDisplayed);
  const setMotionHandle = useDoc((s) => s.setMotionHandle);
  const setPathPoint = useDoc((s) => s.setPathPoint);
  const beginUndoGroup = useDoc((s) => s.beginUndoGroup);
  const endUndoGroup = useDoc((s) => s.endUndoGroup);
  const selectedLayer = selectedId ? layers.find((layer) => layer.id === selectedId) : undefined;
  const updatePenPoints = (next: VectorPathPoint[]) => {
    penPointsRef.current = next;
    setPenPointsState(next);
  };
  const finishPenPath = (closed = false) => {
    const points = penPointsRef.current;
    if (points.length >= 2) addPath(points, closed);
    updatePenPoints([]);
    setPenHover(null);
    penAnchorDrag.current = null;
    if (points.length < 2) setTool("select");
  };
  const finishPenRef = useRef(finishPenPath);
  finishPenRef.current = finishPenPath;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    const previous = previousTool.current;
    previousTool.current = tool;
    if (previous === "pen" && tool !== "pen" && penPointsRef.current.length >= 2) {
      finishPenPath(false);
      if (tool !== "select") setTool(tool);
    }
  }, [tool, setTool]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (toolRef.current !== "pen") return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        finishPenRef.current(false);
      } else if (event.key === "Escape") {
        event.preventDefault();
        updatePenPoints([]);
        penAnchorDrag.current = null;
        setPenHover(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setTool]);

  const beginPointerUndo = () => {
    if (groupedPointer.current) return;
    groupedPointer.current = true;
    beginUndoGroup();
  };
  const endPointerUndo = () => {
    if (!groupedPointer.current) return;
    groupedPointer.current = false;
    endUndoGroup();
  };

  const motionPath = useMemo(() => {
    if (!selectedLayer) return null;
    const times = [...new Set([...selectedLayer.tracks.x, ...selectedLayer.tracks.y].map((key) => key.t))].sort(
      (a, b) => a - b,
    );
    if (times.length === 0) return null;
    const pointAt = (at: number) => ({
      t: at,
      x: displayed(selectedLayer, "x", at) + selectedLayer.w / 2,
      y: displayed(selectedLayer, "y", at) + selectedLayer.h / 2,
    });
    const keyframes = times.map(pointAt);
    const keyAt = (at: number) => keyNear(selectedLayer.tracks.x, at) ?? keyNear(selectedLayer.tracks.y, at);
    const controls: MotionControl[] = times.slice(0, -1).flatMap((startTime, index) => {
      const endTime = times[index + 1];
      const startKey = keyAt(startTime);
      const endKey = keyAt(endTime);
      if (!startKey || startKey.interp !== "bezier" || !endKey) return [];
      const start = pointAt(startTime);
      const end = pointAt(endTime);
      const delta = { x: end.x - start.x, y: end.y - start.y };
      const outOffset = startKey.motionOut ?? { x: delta.x / 3, y: delta.y / 3 };
      const inOffset = endKey.motionIn ?? { x: -delta.x / 3, y: -delta.y / 3 };
      return [{
        start,
        end,
        out: { x: start.x + outOffset.x, y: start.y + outOffset.y },
        in: { x: end.x + inOffset.x, y: end.y + inOffset.y },
        outKeyId: startKey.id,
        inKeyId: endKey.id,
      }];
    });
    const controlByStart = new Map(controls.map((control) => [control.outKeyId, control]));
    const commands = keyframes.length ? [`M ${keyframes[0].x} ${keyframes[0].y}`] : [];
    for (let index = 0; index < keyframes.length - 1; index++) {
      const startKey = keyAt(times[index]);
      const end = keyframes[index + 1];
      const control = startKey ? controlByStart.get(startKey.id) : undefined;
      if (control) {
        commands.push(`C ${control.out.x} ${control.out.y} ${control.in.x} ${control.in.y} ${end.x} ${end.y}`);
      } else {
        commands.push(`L ${end.x} ${end.y}`);
      }
    }
    return { keyframes, pathData: commands.join(" "), controls };
  }, [selectedLayer]);

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
            const pathDrag = pathPointDrag.current;
            if (pathDrag) {
              const local = svgPointInGroup(pathDrag.group, event);
              const dx = local.x - pathDrag.sx;
              const dy = local.y - pathDrag.sy;
              const layer = useDoc.getState().layers.find((item) => item.id === pathDrag.id);
              if (!layer) return;
              const next = { ...pathDrag.startPoint };
              if (pathDrag.side === "anchor") {
                const nx = dx / Math.max(1, layer.w);
                const ny = dy / Math.max(1, layer.h);
                next.x += nx;
                next.y += ny;
                next.inX += nx;
                next.inY += ny;
                next.outX += nx;
                next.outY += ny;
              } else if (pathDrag.side === "out") {
                next.outX = (local.x - layer.x) / Math.max(1, layer.w);
                next.outY = (local.y - layer.y) / Math.max(1, layer.h);
              } else {
                next.inX = (local.x - layer.x) / Math.max(1, layer.w);
                next.inY = (local.y - layer.y) / Math.max(1, layer.h);
              }
              setPathPoint(pathDrag.id, pathDrag.index, next);
              return;
            }
            const tangentDrag = motionHandleDrag.current;
            if (tangentDrag) {
              setMotionHandle(tangentDrag.id, tangentDrag.keyId, tangentDrag.side, {
                x: tangentDrag.offset.x + point.x - tangentDrag.sx,
                y: tangentDrag.offset.y + point.y - tangentDrag.sy,
              });
              return;
            }
            const anchorDrag = penAnchorDrag.current;
            if (anchorDrag) {
              const points = penPointsRef.current;
              const anchor = points[anchorDrag.index];
              if (anchor) {
                const dx = point.x - anchorDrag.sx;
                const dy = point.y - anchorDrag.sy;
                const next = points.slice();
                next[anchorDrag.index] = {
                  ...anchor,
                  inX: anchor.x - dx,
                  inY: anchor.y - dy,
                  outX: anchor.x + dx,
                  outY: anchor.y + dy,
                };
                updatePenPoints(next);
              }
              return;
            }
            if (drawingRef.current) {
              const next = { ...drawingRef.current, endX: point.x, endY: point.y };
              drawingRef.current = next;
              setDrawing(next);
              return;
            }
            if (tool === "pen" && penPointsRef.current.length > 0) {
              setPenHover(point);
              return;
            }
            const r = resize.current;
            if (r) {
              const screenDx = point.x - r.sx;
              const screenDy = point.y - r.sy;
              const angle = (r.rotate * Math.PI) / 180;
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              const dx = (screenDx * cos + screenDy * sin) / Math.max(0.001, Math.abs(r.scaleX));
              const dy = (-screenDx * sin + screenDy * cos) / Math.max(0.001, Math.abs(r.scaleY));
              let w = Math.max(12, r.w + (r.hx < 0 ? -dx : r.hx > 0 ? dx : 0));
              let h = Math.max(12, r.h + (r.hy < 0 ? -dy : r.hy > 0 ? dy : 0));
              let factorX = r.hx === 0 ? 1 : w / r.w;
              let factorY = r.hy === 0 ? 1 : h / r.h;
              if (r.lockRatio) {
                const xMotion = r.hx === 0 ? 0 : Math.abs(dx / r.w);
                const yMotion = r.hy === 0 ? 0 : Math.abs(dy / r.h);
                const factor = xMotion > yMotion ? factorX : factorY;
                factorX = factor;
                factorY = factor;
                w = Math.max(12, r.w * factorX);
                h = Math.max(12, r.h * factorY);
              }
              if (r.scaleAnimated) {
                const nextScaleX = Math.max(0.01, r.scaleX * factorX);
                const nextScaleY = Math.max(0.01, r.scaleY * factorY);
                const localShiftX = (r.hx * r.w * (nextScaleX - r.scaleX)) / 2;
                const localShiftY = (r.hy * r.h * (nextScaleY - r.scaleY)) / 2;
                const shiftX = cos * localShiftX - sin * localShiftY;
                const shiftY = sin * localShiftX + cos * localShiftY;
                setDisplayed(r.id, "scale", nextScaleX, true);
                setDisplayed(r.id, "scaleY", nextScaleY, true);
                setDisplayed(r.id, "x", r.x + r.dx + shiftX, true);
                setDisplayed(r.id, "y", r.y + r.dy + shiftY, true);
                return;
              }
              const patch: { x: number; y: number; w: number; h: number; fontSize?: number } = {
                x:
                  r.hx < 0
                    ? r.x + r.w - w
                    : r.hx === 0 && r.lockRatio
                      ? r.x + (r.w - w) / 2
                      : r.x,
                y:
                  r.hy < 0
                    ? r.y + r.h - h
                    : r.hy === 0 && r.lockRatio
                      ? r.y + (r.h - h) / 2
                      : r.y,
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
          onPointerUp={(event) => {
            const svg = svgRef.current;
            if (drawingRef.current && svg) {
              const start = drawingRef.current;
              const point = svgPoint(svg, event);
              const finalDrawing = { ...start, endX: point.x, endY: point.y };
              const distance = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY);
              drawingRef.current = null;
              setDrawing(null);
              if (distance < 3) {
                addShape(start.kind, start.x, start.y);
              } else {
                const bounds = drawingBounds(finalDrawing, true);
                addShape(start.kind, bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, bounds);
              }
            }
            drag.current = null;
            resize.current = null;
            penAnchorDrag.current = null;
            motionHandleDrag.current = null;
            pathPointDrag.current = null;
            endPointerUndo();
            setSnapGuides(null);
          }}
          onLostPointerCapture={() => {
            if (drawingRef.current) {
              const pending = drawingRef.current;
              drawingRef.current = null;
              setDrawing(null);
              const bounds = drawingBounds(pending, true);
              addShape(pending.kind, bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, bounds);
            }
            drag.current = null;
            resize.current = null;
            penAnchorDrag.current = null;
            motionHandleDrag.current = null;
            pathPointDrag.current = null;
            endPointerUndo();
            setSnapGuides(null);
          }}
          onPointerDown={(event) => {
            const target = event.target as Element;
            const svg = svgRef.current;
            if (!svg) return;
            const p = svgPoint(svg, event);
            const motionHandle = target.closest<SVGCircleElement>("[data-motion-handle]");
            if (motionHandle && selectedLayer) {
              const side = motionHandle.dataset.motionHandle as "in" | "out";
              const keyId = motionHandle.dataset.keyId;
              const control = motionPath?.controls.find((item) => side === "out" ? item.outKeyId === keyId : item.inKeyId === keyId);
              const key = [...selectedLayer.tracks.x, ...selectedLayer.tracks.y].find((item) => item.id === keyId);
              if (key && control && keyId) {
                const origin = side === "out" ? control.start : control.end;
                const handlePoint = side === "out" ? control.out : control.in;
                const offset = side === "in" ? key.motionIn : key.motionOut;
                motionHandleDrag.current = {
                  id: selectedLayer.id,
                  keyId,
                  side,
                  sx: p.x,
                  sy: p.y,
                  offset: offset ?? { x: handlePoint.x - origin.x, y: handlePoint.y - origin.y },
                };
                beginPointerUndo();
                svg.setPointerCapture(event.pointerId);
                event.preventDefault();
                return;
              }
            }
            if (tool === "pen") {
              event.preventDefault();
              const anchor = target.closest<SVGCircleElement>("[data-pen-anchor]");
              if (anchor) {
                const index = Number(anchor.dataset.penAnchor);
                if (index === 0 && penPointsRef.current.length >= 3) {
                  finishPenRef.current(true);
                  return;
                }
                penAnchorDrag.current = { index, sx: p.x, sy: p.y };
                svg.setPointerCapture(event.pointerId);
                return;
              }
              const first = penPointsRef.current[0];
              const matrix = svg.getScreenCTM();
              const closeDistance = first && matrix
                ? Math.hypot((first.x - p.x) * matrix.a, (first.y - p.y) * matrix.d)
                : Infinity;
              if (event.detail > 1) {
                finishPenRef.current(false);
                return;
              }
              if (penPointsRef.current.length >= 3 && closeDistance <= 12) {
                finishPenRef.current(true);
                return;
              }
              updatePenPoints([...penPointsRef.current, pathPoint(p.x, p.y)]);
              penAnchorDrag.current = {
                index: penPointsRef.current.length - 1,
                sx: p.x,
                sy: p.y,
              };
              svg.setPointerCapture(event.pointerId);
              return;
            }
            if (tool !== "select") {
              const next: Drawing = {
                kind: tool,
                x: p.x,
                y: p.y,
                clientX: event.clientX,
                clientY: event.clientY,
                endX: p.x,
                endY: p.y,
              };
              drawingRef.current = next;
              setDrawing(next);
              svg.setPointerCapture(event.pointerId);
              return;
            }
            const backdrop = target.id === "stage-bg" || target === event.currentTarget;
            if (!backdrop) return;
            if (tool === "select") {
              selectLayer(null);
            }
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
                  if (selected && layer.kind === "path" && layer.path) {
                    const target = event.target as Element;
                    const handle = target.closest<SVGCircleElement>("[data-path-handle]");
                    const anchor = target.closest<SVGCircleElement>("[data-path-anchor]");
                    const marker = handle ?? anchor;
                    if (marker) {
                      const index = Number(marker.dataset.pathHandleIndex ?? marker.dataset.pathAnchor);
                      const pointData = layer.path[index];
                      if (pointData) {
                        const local = svgPointInGroup(event.currentTarget, event);
                        pathPointDrag.current = {
                          id: layer.id,
                          index,
                          side: handle?.dataset.pathHandle === "in"
                            ? "in"
                            : handle?.dataset.pathHandle === "out"
                              ? "out"
                              : "anchor",
                          sx: local.x,
                          sy: local.y,
                          startPoint: { ...pointData },
                          group: event.currentTarget,
                        };
                        beginPointerUndo();
                        svg.setPointerCapture(event.pointerId);
                        return;
                      }
                    }
                  }
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
                  beginPointerUndo();
                  svg.setPointerCapture(event.pointerId);
                }}
              >
                <g
                  opacity={layer.visible ? p.opacity : 0}
                  filter={blurByLayer.has(layer.id) ? `url(#motion-blur-${layer.id})` : undefined}
                >
                  <ShapeBody layer={layer} time={time} />
                </g>
                {layer.kind === "path" && (
                  <path
                    d={layerPathData(layer)}
                    className="stage-path-hit-area"
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    pointerEvents="stroke"
                  />
                )}
                {selected && (
                  <rect
                    x={layer.x - 4}
                    y={layer.y - 4}
                    width={layer.w + 8}
                    height={layer.h + 8}
                    fill="none"
                    className="stage-selection-outline-outer"
                    pointerEvents="none"
                  />
                )}
                {selected && (
                  <rect
                    x={layer.x - 4}
                    y={layer.y - 4}
                    width={layer.w + 8}
                    height={layer.h + 8}
                    className="stage-selection-outline-inner"
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
                          const currentPose = pose(layer, time);
                          resize.current = {
                            id: layer.id,
                            sx: point.x,
                            sy: point.y,
                            x: layer.x,
                            y: layer.y,
                            w: layer.w,
                            h: layer.h,
                            scaleX: currentPose.scale,
                            scaleY: currentPose.scaleY,
                            rotate: currentPose.rotate,
                            dx: currentPose.dx,
                            dy: currentPose.dy,
                            fontSize: layer.fontSize,
                            lockRatio: layer.scaleLinked !== false,
                            scaleFontSize: layer.kind === "text",
                            scaleAnimated:
                              layer.armed.scale ||
                              layer.armed.scaleY ||
                              useDoc.getState().autoKey,
                            hx: handle.hx as -1 | 0 | 1,
                            hy: handle.hy as -1 | 0 | 1,
                          };
                          beginPointerUndo();
                          svg.setPointerCapture(event.pointerId);
                        }}
                      />
                    ))}
                  </g>
                )}
                {selected && layer.kind === "path" && layer.path && tool === "select" && (
                  <g className="stage-path-edit-overlay" aria-label="编辑路径锚点">
                    {layer.path.map((point, index) => {
                      const x = layer.x + point.x * layer.w;
                      const y = layer.y + point.y * layer.h;
                      const inX = layer.x + point.inX * layer.w;
                      const inY = layer.y + point.inY * layer.h;
                      const outX = layer.x + point.outX * layer.w;
                      const outY = layer.y + point.outY * layer.h;
                      const hasIn = Math.hypot(inX - x, inY - y) > 0.5;
                      const hasOut = Math.hypot(outX - x, outY - y) > 0.5;
                      return (
                        <g key={index}>
                          {hasIn && <line x1={x} y1={y} x2={inX} y2={inY} className="stage-pen-handle-line" />}
                          {hasOut && <line x1={x} y1={y} x2={outX} y2={outY} className="stage-pen-handle-line" />}
                          {hasIn && <circle data-path-handle="in" data-path-handle-index={index} cx={inX} cy={inY} r={8} className="stage-path-handle" pointerEvents="all"><title>拖动调整入侧手柄</title></circle>}
                          {hasOut && <circle data-path-handle="out" data-path-handle-index={index} cx={outX} cy={outY} r={8} className="stage-path-handle" pointerEvents="all"><title>拖动调整出侧手柄</title></circle>}
                          <circle data-path-anchor={index} cx={x} cy={y} r={6} className="stage-path-anchor" pointerEvents="all">
                            <title>{`路径锚点 ${index + 1} · 拖动移动锚点`}</title>
                          </circle>
                        </g>
                      );
                    })}
                  </g>
                )}
              </g>
            );
          })}
          {drawing && (() => {
            const bounds = drawingBounds(drawing);
            const common = { fill: "rgba(76,159,255,.22)", stroke: "var(--color-primary)", strokeWidth: 2, strokeDasharray: "6 4", pointerEvents: "none" as const };
            return (
              <g className="stage-drawing-preview" aria-hidden="true">
                {drawing.kind === "circle" ? (
                  <circle cx={bounds.x + bounds.w / 2} cy={bounds.y + bounds.h / 2} r={Math.min(bounds.w, bounds.h) / 2} {...common} />
                ) : drawing.kind === "ellipse" ? (
                  <ellipse cx={bounds.x + bounds.w / 2} cy={bounds.y + bounds.h / 2} rx={bounds.w / 2} ry={bounds.h / 2} {...common} />
                ) : drawing.kind === "star" ? (
                  <path d={starPathData(bounds.x, bounds.y, bounds.w, bounds.h)} {...common} />
                ) : drawing.kind === "text" ? (
                  <g pointerEvents="none">
                    <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} fill="rgba(76,159,255,.12)" stroke="var(--color-primary)" strokeDasharray="6 4" />
                    <text x={bounds.x + 8} y={bounds.y + 24} fill="var(--color-fg)" fontSize={18}>T 文字图层</text>
                  </g>
                ) : (
                  <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} rx={8} {...common} />
                )}
              </g>
            );
          })()}
          {tool === "pen" && penPoints.length > 0 && (
            <g className="stage-pen-preview" aria-hidden="true">
              <path
                d={vectorPathData(penHover ? [...penPoints, pathPoint(penHover.x, penHover.y)] : penPoints)}
                className="stage-pen-preview-line"
              />
              {penPoints.map((point, index) => (
                <g key={index}>
                  {(Math.abs(point.outX - point.x) > 0.1 || Math.abs(point.outY - point.y) > 0.1) && <line x1={point.x} y1={point.y} x2={point.outX} y2={point.outY} className="stage-pen-handle-line" />}
                  {(Math.abs(point.inX - point.x) > 0.1 || Math.abs(point.inY - point.y) > 0.1) && <line x1={point.x} y1={point.y} x2={point.inX} y2={point.inY} className="stage-pen-handle-line" />}
                  <circle data-pen-anchor={index} cx={point.x} cy={point.y} r={6} className="stage-pen-anchor" pointerEvents="all" />
                  {index === 0 && <title>点击闭合路径；双击或 Enter 完成，Esc 取消</title>}
                </g>
              ))}
            </g>
          )}
          {selectedLayer && motionPath && (
            <g className="stage-motion-path-overlay" pointerEvents="none" aria-hidden="true">
              {motionPath.pathData && motionPath.keyframes.length > 1 && (
                <path className="stage-motion-path-line" d={motionPath.pathData} />
              )}
              {motionPath.keyframes.map((point, index) => (
                <circle
                  key={`${point.t}-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={7}
                  className={index === 0 ? "stage-motion-path-key is-first" : "stage-motion-path-key"}
                >
                  <title>{`位置关键帧 ${point.t.toFixed(2)}s`}</title>
                </circle>
              ))}
              {motionPath.controls.map((control) => (
                <g key={`${control.outKeyId}-${control.inKeyId}`} className="stage-motion-controls">
                  <line x1={control.start.x} y1={control.start.y} x2={control.out.x} y2={control.out.y} className="stage-motion-handle-line" />
                  <line x1={control.end.x} y1={control.end.y} x2={control.in.x} y2={control.in.y} className="stage-motion-handle-line" />
                  <circle data-motion-handle="out" data-key-id={control.outKeyId} cx={control.out.x} cy={control.out.y} r={9} className="stage-motion-handle" role="button" aria-label="拖动贝塞尔出手柄" />
                  <circle data-motion-handle="in" data-key-id={control.inKeyId} cx={control.in.x} cy={control.in.y} r={9} className="stage-motion-handle" role="button" aria-label="拖动贝塞尔入手柄" />
                </g>
              ))}
              <circle
                cx={displayed(selectedLayer, "x", time) + selectedLayer.w / 2}
                cy={displayed(selectedLayer, "y", time) + selectedLayer.h / 2}
                r={7}
                className="stage-motion-path-current"
              />
            </g>
          )}
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
            <p className="mt-1 text-sm text-muted">选择形状工具后，在画布上按住并拖动绘制</p>
          </div>
        </div>
      )}
    </div>
  );
}
