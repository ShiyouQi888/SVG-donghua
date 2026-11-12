export const FPS = 30;
export const PROPS = [
  "opacity",
  "x",
  "y",
  "rotate",
  "scale",
  "scaleY",
  "fill",
  "stroke",
  "strokeWidth",
] as const;
export type PropKey = (typeof PROPS)[number];
export const TRANSFORM_PROPS = [
  "opacity",
  "x",
  "y",
  "rotate",
  "scale",
  "scaleY",
] as const satisfies readonly PropKey[];
export const STYLE_PROPS = ["fill", "stroke", "strokeWidth"] as const satisfies readonly PropKey[];
export const COLOR_PROPS = ["fill", "stroke"] as const;
export type ColorPropKey = (typeof COLOR_PROPS)[number];
export type Interp = "linear" | "hold" | "ease" | "bezier";
export type BezierCurve = { x1: number; y1: number; x2: number; y2: number };
export type ShapeKind = "rect" | "circle" | "ellipse" | "text" | "image" | "star" | "path";
export type DrawShapeKind = Exclude<ShapeKind, "image" | "path">;
export type Tool = "select" | "pen" | DrawShapeKind;
export type VectorPathPoint = {
  x: number;
  y: number;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
};
export type MotionTangent = { x: number; y: number };

export const PROP_LABEL: Record<PropKey, string> = {
  opacity: "透明度",
  x: "位置 X",
  y: "位置 Y",
  rotate: "旋转",
  scale: "缩放 X",
  scaleY: "缩放 Y",
  fill: "填充",
  stroke: "描边颜色",
  strokeWidth: "描边粗细",
};

export type Keyframe = {
  id: string;
  t: number;
  v: number;
  interp: Interp;
  bezier: BezierCurve;
  motionIn?: MotionTangent;
  motionOut?: MotionTangent;
};

export const DEFAULT_BEZIER: BezierCurve = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };

export type Layer = {
  id: string;
  kind: ShapeKind;
  name: string;
  visible: boolean;
  scaleLinked?: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text: string;
  fontSize: number;
  fontWeight?: number;
  imageSrc?: string;
  /** Normalized anchor positions and tangent handles for custom pen paths. */
  path?: VectorPathPoint[];
  closed?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  armed: Record<PropKey, boolean>;
  tracks: Record<PropKey, Keyframe[]>;
  rest: Record<PropKey, number>;
};

export type PersistedDoc = {
  duration: number;
  pxPerSec: number;
  projectWidth?: number;
  projectHeight?: number;
  exportWidth?: number;
  exportHeight?: number;
  safeArea?: boolean;
  snapEnabled?: boolean;
  motionBlur?: boolean;
  motionBlurStrength?: number;
  layers: Layer[];
};

export type MotionBlurSettings = { enabled: boolean; strength: number };

export type ExportDimensions = {
  projectWidth: number;
  projectHeight: number;
  exportWidth: number;
  exportHeight: number;
};

const NEAR = 0.5 / FPS;

export function nid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyTracks(): Record<PropKey, Keyframe[]> {
  return {
    opacity: [],
    x: [],
    y: [],
    rotate: [],
    scale: [],
    scaleY: [],
    fill: [],
    stroke: [],
    strokeWidth: [],
  };
}

export function emptyArmed(on = false): Record<PropKey, boolean> {
  return {
    opacity: on,
    x: on,
    y: on,
    rotate: on,
    scale: on,
    scaleY: on,
    fill: on,
    stroke: on,
    strokeWidth: on,
  };
}

export function defaultRest(): Record<PropKey, number> {
  return {
    opacity: 1,
    x: 0,
    y: 0,
    rotate: 0,
    scale: 1,
    scaleY: 1,
    fill: 0,
    stroke: 0,
    strokeWidth: 2,
  };
}

export function colorToNumber(color: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  return match ? Number.parseInt(match[1], 16) : 0;
}

export function numberToColor(value: number): string {
  const packed = Math.min(0xffffff, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
  return `#${packed.toString(16).padStart(6, "0")}`;
}

function blendColor(from: number, to: number, amount: number): number {
  const a = Math.round(from);
  const b = Math.round(to);
  const channel = (shift: number) => {
    const left = (a >> shift) & 0xff;
    const right = (b >> shift) & 0xff;
    return Math.round(left + (right - left) * amount);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export function snapTime(t: number, duration: number): number {
  const f = Math.round(t * FPS) / FPS;
  return Math.min(duration, Math.max(0, f));
}

export function fmtTime(t: number): string {
  const frames = Math.round(t * FPS);
  const sec = Math.floor(frames / FPS);
  const fr = frames % FPS;
  return `${sec}:${String(fr).padStart(2, "0")}`;
}

export function sample(track: Keyframe[], t: number, fallback: number, color = false): number {
  if (track.length === 0) return fallback;
  const sorted = track;
  if (t <= sorted[0].t) return sorted[0].v;
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t < a.t || t > b.t) continue;
    if (a.interp === "hold") return a.v;
    const span = b.t - a.t;
    const u = span <= 1e-8 ? 0 : (t - a.t) / span;
    const e =
      a.interp === "ease"
        ? u * u * (3 - 2 * u)
        : a.interp === "bezier"
          ? bezierProgress(u, a.bezier ?? DEFAULT_BEZIER)
          : u;
    return color ? blendColor(a.v, b.v, e) : a.v + (b.v - a.v) * e;
  }
  return fallback;
}

function cubicCoordinate(t: number, p1: number, p2: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t * t * t;
}

function cubicDerivative(t: number, p1: number, p2: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * p1 + 6 * inverse * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/** Resolve the x parameter, then evaluate the y side of a cubic Bezier easing curve. */
export function bezierProgress(x: number, curve: BezierCurve): number {
  const x1 = clamp01(curve.x1);
  const x2 = clamp01(curve.x2);
  const y1 = clamp01(curve.y1);
  const y2 = clamp01(curve.y2);
  let t = x;

  for (let i = 0; i < 8; i++) {
    const error = cubicCoordinate(t, x1, x2) - x;
    const slope = cubicDerivative(t, x1, x2);
    if (Math.abs(error) < 1e-5) return cubicCoordinate(t, y1, y2);
    if (Math.abs(slope) < 1e-5) break;
    const next = t - error / slope;
    if (next < 0 || next > 1) break;
    t = next;
  }

  let low = 0;
  let high = 1;
  for (let i = 0; i < 18; i++) {
    t = (low + high) / 2;
    const value = cubicCoordinate(t, x1, x2);
    if (Math.abs(value - x) < 1e-5) break;
    if (value < x) low = t;
    else high = t;
  }
  return cubicCoordinate(t, y1, y2);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function keyNear(track: Keyframe[], t: number): Keyframe | undefined {
  return track.find((k) => Math.abs(k.t - t) < NEAR);
}

function rawPositionAt(layer: Layer, t: number): { x: number; y: number } {
  return {
    x: layer.x + sample(layer.tracks.x, t, layer.rest.x),
    y: layer.y + sample(layer.tracks.y, t, layer.rest.y),
  };
}

function cubicPoint(
  start: { x: number; y: number },
  control1: { x: number; y: number },
  control2: { x: number; y: number },
  end: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * start.x + b * control1.x + c * control2.x + d * end.x,
    y: a * start.y + b * control1.y + c * control2.y + d * end.y,
  };
}

/** Sample a layer's animated XY position, including editable spatial Bezier tangents. */
export function positionAt(layer: Layer, t: number): { x: number; y: number } {
  const times = [...new Set([...layer.tracks.x, ...layer.tracks.y].map((key) => key.t))].sort(
    (a, b) => a - b,
  );
  if (times.length < 2 || t <= times[0] || t >= times.at(-1)!) return rawPositionAt(layer, t);

  for (let index = 0; index < times.length - 1; index++) {
    const startTime = times[index];
    const endTime = times[index + 1];
    if (t < startTime || t > endTime) continue;
    const startKey = keyNear(layer.tracks.x, startTime) ?? keyNear(layer.tracks.y, startTime);
    const endKey = keyNear(layer.tracks.x, endTime) ?? keyNear(layer.tracks.y, endTime);
    if (startKey?.interp !== "bezier" || (!startKey.motionOut && !endKey?.motionIn)) {
      return rawPositionAt(layer, t);
    }
    const start = rawPositionAt(layer, startTime);
    const end = rawPositionAt(layer, endTime);
    const delta = { x: end.x - start.x, y: end.y - start.y };
    const control1 = {
      x: start.x + (startKey.motionOut?.x ?? delta.x / 3),
      y: start.y + (startKey.motionOut?.y ?? delta.y / 3),
    };
    const control2 = {
      x: end.x + (endKey?.motionIn?.x ?? -delta.x / 3),
      y: end.y + (endKey?.motionIn?.y ?? -delta.y / 3),
    };
    const progress = bezierProgress((t - startTime) / Math.max(1e-8, endTime - startTime), startKey.bezier);
    return cubicPoint(start, control1, control2, end, progress);
  }
  return rawPositionAt(layer, t);
}

export function displayed(layer: Layer, prop: PropKey, t: number): number {
  const color = prop === "fill" || prop === "stroke";
  const fallback =
    prop === "fill"
      ? (layer.rest.fill ?? colorToNumber(layer.fill))
      : prop === "stroke"
        ? (layer.rest.stroke ?? colorToNumber(layer.stroke))
        : (layer.rest[prop] ?? defaultRest()[prop]);
  const v = sample(layer.tracks[prop], t, fallback, color);
  if (prop === "x" || prop === "y") return positionAt(layer, t)[prop];
  return v;
}

export function pose(layer: Layer, t: number) {
  const position = positionAt(layer, t);
  return {
    opacity: displayed(layer, "opacity", t),
    dx: position.x - layer.x,
    dy: position.y - layer.y,
    rotate: displayed(layer, "rotate", t),
    scale: displayed(layer, "scale", t),
    scaleY: displayed(layer, "scaleY", t),
  };
}

export function motionBlurVector(
  layer: Layer,
  t: number,
  duration: number,
  strength: number,
): { x: number; y: number } {
  if (strength <= 0 || duration <= 0) return { x: 0, y: 0 };
  const sampleOffset = 0.5 / FPS;
  const fromTime = Math.max(0, t - sampleOffset);
  const toTime = Math.min(duration, t + sampleOffset);
  if (toTime - fromTime <= 1e-6) return { x: 0, y: 0 };

  const centerX = layer.x + layer.w / 2;
  const centerY = layer.y + layer.h / 2;
  const corners = [
    [layer.x, layer.y],
    [layer.x + layer.w, layer.y],
    [layer.x, layer.y + layer.h],
    [layer.x + layer.w, layer.y + layer.h],
  ] as const;
  const pointsAt = (time: number) => {
    const current = pose(layer, time);
    const angle = (current.rotate * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return corners.map(([x, y]) => {
      const scaledX = (x - centerX) * current.scale;
      const scaledY = (y - centerY) * current.scaleY;
      return {
        x: centerX + current.dx + scaledX * cos - scaledY * sin,
        y: centerY + current.dy + scaledX * sin + scaledY * cos,
      };
    });
  };
  const from = pointsAt(fromTime);
  const to = pointsAt(toTime);
  const maxX = Math.max(...to.map((point, i) => Math.abs(point.x - from[i].x)));
  const maxY = Math.max(...to.map((point, i) => Math.abs(point.y - from[i].y)));
  const blurScale = Math.min(12, Math.max(0, strength)) * 0.25;
  return {
    x: Math.min(32, maxX * blurScale),
    y: Math.min(32, maxY * blurScale),
  };
}

export function motionBlurFilterRegion(
  layer: Pick<Layer, "w" | "h">,
  blur: { x: number; y: number },
): { x: string; y: string; width: string; height: string } {
  // SVG clips blur output at the filter region; extend it past four sigma so the tail fades naturally.
  const paddingPercent = (deviation: number, size: number) =>
    Math.max(2, Math.ceil((deviation * 4 * 100) / Math.max(1, size)));
  const padX = paddingPercent(blur.x, layer.w);
  const padY = paddingPercent(blur.y, layer.h);
  return {
    x: `-${padX}%`,
    y: `-${padY}%`,
    width: `${100 + padX * 2}%`,
    height: `${100 + padY * 2}%`,
  };
}

export function vectorPathData(points: VectorPathPoint[], closed = false): string {
  if (points.length === 0) return "";
  const start = points[0];
  const commands = [`M ${start.x} ${start.y}`];
  const segment = (from: VectorPathPoint, to: VectorPathPoint) => {
    const hasCurveHandle =
      Math.abs(from.outX - from.x) > 0.001 ||
      Math.abs(from.outY - from.y) > 0.001 ||
      Math.abs(to.inX - to.x) > 0.001 ||
      Math.abs(to.inY - to.y) > 0.001;
    return hasCurveHandle
      ? `C ${from.outX} ${from.outY} ${to.inX} ${to.inY} ${to.x} ${to.y}`
      : `L ${to.x} ${to.y}`;
  };
  for (let index = 1; index < points.length; index++) {
    commands.push(segment(points[index - 1], points[index]));
  }
  if (closed) {
    commands.push(segment(points.at(-1)!, start), "Z");
  }
  return commands.join(" ");
}

export function layerPathData(layer: Layer): string {
  const points = (layer.path ?? []).map((point) => ({
    x: layer.x + point.x * layer.w,
    y: layer.y + point.y * layer.h,
    inX: layer.x + point.inX * layer.w,
    inY: layer.y + point.inY * layer.h,
    outX: layer.x + point.outX * layer.w,
    outY: layer.y + point.outY * layer.h,
  }));
  return vectorPathData(points, layer.closed);
}

export function starPathData(x: number, y: number, width: number, height: number): string {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const outerX = width / 2;
  const outerY = height / 2;
  const inner = 0.44;
  const points = Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    const radius = index % 2 === 0 ? 1 : inner;
    return {
      x: centerX + Math.cos(angle) * outerX * radius,
      y: centerY + Math.sin(angle) * outerY * radius,
    };
  });
  return `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`;
}

export function makeLayer(kind: ShapeKind, x: number, y: number, n: number): Layer {
  const size =
    kind === "text"
      ? { w: 160, h: 40 }
      : kind === "circle"
        ? { w: 96, h: 96 }
      : kind === "image"
          ? { w: 320, h: 180 }
          : { w: 140, h: 88 };
  const names: Record<ShapeKind, string> = {
    rect: "矩形",
    circle: "圆形",
    ellipse: "椭圆",
    text: "文字",
    star: "五角星",
    path: "自由路径",
    image: "图片",
  };
  const fill = kind === "text" ? "#e7ebf2" : kind === "path" ? "none" : "#4c9fff";
  const stroke = "#e7ebf2";
  const strokeWidth = kind === "text" ? 0 : 2;
  return {
    id: nid("el"),
    kind,
    name: `${names[kind]} ${n}`,
    visible: true,
    scaleLinked: true,
    fill,
    stroke,
    strokeWidth,
    text: "金帧",
    fontSize: 28,
    fontWeight: 600,
    x: x - size.w / 2,
    y: y - size.h / 2,
    w: size.w,
    h: size.h,
    armed: emptyArmed(false),
    tracks: emptyTracks(),
    rest: {
      ...defaultRest(),
      fill: colorToNumber(fill),
      stroke: colorToNumber(stroke),
      strokeWidth,
    },
  };
}

function key(id: string, t: number, v: number, interp: Interp = "ease"): Keyframe {
  return { id, t, v, interp, bezier: { ...DEFAULT_BEZIER } };
}

export const DEMO_DURATION = 6.6;
export const DEMO_WIDTH = 1920;
export const DEMO_HEIGHT = 1080;

export function demoLayers(): Layer[] {
  const layers: Layer[] = [];
  const add = (
    kind: ShapeKind,
    id: string,
    name: string,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    fill: string,
    stroke = fill === "none" ? "#121a25" : fill,
    strokeWidth = 0,
  ) => {
    const layer = makeLayer(kind, centerX, centerY, layers.length + 1);
    layer.id = id;
    layer.name = name;
    layer.x = centerX - width / 2;
    layer.y = centerY - height / 2;
    layer.w = width;
    layer.h = height;
    layer.fill = fill;
    layer.stroke = stroke;
    layer.strokeWidth = strokeWidth;
    layer.rest = {
      ...layer.rest,
      fill: fill === "none" ? 0 : colorToNumber(fill),
      stroke: colorToNumber(stroke),
      strokeWidth,
    };
    layers.push(layer);
    return layer;
  };
  const animate = (
    layer: Layer,
    prop: PropKey,
    frames: Array<[number, number, Interp?]>,
  ) => {
    layer.armed[prop] = true;
    layer.tracks[prop] = frames.map(([time, value, interp = "ease"], index) =>
      key(`${layer.id}-${prop}-${index}`, time, value, interp),
    );
  };
  const text = (
    id: string,
    name: string,
    value: string,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    fontSize: number,
    fill: string,
    fontWeight = 600,
  ) => {
    const layer = add("text", id, name, centerX, centerY, width, height, fill);
    layer.text = value;
    layer.fontSize = fontSize;
    layer.fontWeight = fontWeight;
    return layer;
  };

  const ink = "#0b111a";
  const panel = "#101823";
  const gold = "#e6b325";
  const goldLight = "#f3d36b";
  const blue = "#4c9fff";
  const white = "#e7ebf2";
  const muted = "#8b9aaa";

  add("rect", "brand-bg", "午夜蓝背景", 960, 540, DEMO_WIDTH, DEMO_HEIGHT, ink, ink, 0);

  const halo = add("ellipse", "brand-halo", "中心光晕", 960, 536, 1460, 720, "#172536");
  animate(halo, "opacity", [[0, 0], [0.9, 0.5], [2, 0.38], [DEMO_DURATION, 0.28]]);
  animate(halo, "scale", [[0, 0.86], [1.2, 1], [DEMO_DURATION, 1.04, "linear"]]);
  animate(halo, "scaleY", [[0, 0.86], [1.2, 1], [DEMO_DURATION, 1.04, "linear"]]);

  const ghost = text("brand-ghost-k", "背景字标", "K", 960, 910, 750, 730, 680, "#1a2633", 700);
  animate(ghost, "opacity", [[0, 0.02], [1.3, 0.26], [DEMO_DURATION, 0.17, "linear"]]);
  animate(ghost, "scale", [[0, 1.12], [1.4, 1], [DEMO_DURATION, 1.03, "linear"]]);
  animate(ghost, "scaleY", [[0, 1.12], [1.4, 1], [DEMO_DURATION, 1.03, "linear"]]);

  const heroPanel = add("rect", "brand-panel", "品牌展示面板", 960, 538, 1350, 520, panel, "#243243", 1);
  animate(heroPanel, "opacity", [[0, 0], [0.5, 0], [1.25, 0.86], [DEMO_DURATION, 0.68, "linear"]]);
  animate(heroPanel, "scale", [[0, 0.92], [1.25, 1], [DEMO_DURATION, 1, "linear"]]);
  animate(heroPanel, "scaleY", [[0, 0.92], [1.25, 1], [DEMO_DURATION, 1, "linear"]]);

  const outerOrbit = add("ellipse", "brand-orbit-outer", "外环轨道", 960, 535, 1510, 720, "none", "#34506a", 2);
  animate(outerOrbit, "opacity", [[0, 0], [0.85, 0.36], [1.5, 0.7], [DEMO_DURATION, 0.42, "linear"]]);
  animate(outerOrbit, "rotate", [[0.18, -15], [1.4, 0], [DEMO_DURATION, 18, "linear"]]);
  animate(outerOrbit, "scale", [[0.18, 0.94], [1.35, 1], [DEMO_DURATION, 1.025, "linear"]]);
  animate(outerOrbit, "scaleY", [[0.18, 0.94], [1.35, 1], [DEMO_DURATION, 1.025, "linear"]]);

  const innerOrbit = add("ellipse", "brand-orbit-inner", "金色内环", 960, 535, 1140, 442, "none", "#705824", 2);
  animate(innerOrbit, "opacity", [[0.2, 0], [1.1, 0.42], [2, 0.28], [DEMO_DURATION, 0.22, "linear"]]);
  animate(innerOrbit, "rotate", [[0.2, 15], [1.5, 0], [DEMO_DURATION, -22, "linear"]]);

  const frameTop = add("rect", "brand-frame-top", "顶边高光", 960, 280, 1200, 2, "#2b3b4c");
  animate(frameTop, "opacity", [[0.45, 0], [1.15, 0.78], [DEMO_DURATION, 0.44, "linear"]]);
  animate(frameTop, "scale", [[0.45, 0.02], [1.15, 1], [DEMO_DURATION, 0.92, "linear"]]);

  const frameBottom = add("rect", "brand-frame-bottom", "底边高光", 960, 798, 1200, 2, "#2b3b4c");
  animate(frameBottom, "opacity", [[0.75, 0], [1.4, 0.56], [DEMO_DURATION, 0.35, "linear"]]);
  animate(frameBottom, "scale", [[0.75, 0.02], [1.4, 1], [DEMO_DURATION, 0.92, "linear"]]);

  const topLabel = text("brand-label-top", "品牌标识", "KAIRO  /  MOTION STUDIO", 450, 216, 470, 38, 24, blue, 600);
  animate(topLabel, "opacity", [[0.2, 0], [0.7, 1], [DEMO_DURATION, 0.68, "linear"]]);
  animate(topLabel, "x", [[0.2, -36], [0.8, 0]]);
  const topMeta = text("brand-label-meta", "画面规格", "SVG  ·  VECTOR  ·  30 FPS", 1480, 216, 460, 38, 22, muted, 500);
  animate(topMeta, "opacity", [[0.55, 0], [1.15, 0.8], [DEMO_DURATION, 0.52, "linear"]]);
  animate(topMeta, "x", [[0.55, 44], [1.2, 0]]);

  const kStem = add("rect", "brand-k-stem", "K 字标主干", 600, 508, 22, 174, goldLight);
  animate(kStem, "opacity", [[0.24, 0], [0.56, 1], [DEMO_DURATION, 1, "linear"]]);
  animate(kStem, "scale", [[0.24, 0.08], [0.62, 1]]);
  animate(kStem, "scaleY", [[0.24, 0.58], [0.62, 1]]);
  animate(kStem, "rotate", [[0.24, -8], [0.62, 0]]);

  const kUpper = add("rect", "brand-k-upper", "K 字标上臂", 662, 466, 122, 18, blue);
  kUpper.rest.rotate = -42;
  animate(kUpper, "opacity", [[0.42, 0], [0.84, 1], [DEMO_DURATION, 1, "linear"]]);
  animate(kUpper, "scale", [[0.42, 0.05], [0.9, 1]]);
  animate(kUpper, "scaleY", [[0.42, 0.7], [0.9, 1]]);
  animate(kUpper, "rotate", [[0.42, -82], [0.92, -42]]);

  const kLower = add("rect", "brand-k-lower", "K 字标下臂", 662, 550, 122, 18, gold);
  kLower.rest.rotate = 42;
  animate(kLower, "opacity", [[0.55, 0], [0.98, 1], [DEMO_DURATION, 1, "linear"]]);
  animate(kLower, "scale", [[0.55, 0.05], [1.02, 1]]);
  animate(kLower, "scaleY", [[0.55, 0.7], [1.02, 1]]);
  animate(kLower, "rotate", [[0.55, 82], [1.05, 42]]);

  const verticalDivider = add("rect", "brand-divider", "字标分隔线", 760, 510, 2, 154, "#35475a");
  animate(verticalDivider, "opacity", [[0.72, 0], [1.12, 0.9], [DEMO_DURATION, 0.58, "linear"]]);
  animate(verticalDivider, "scaleY", [[0.72, 0.05], [1.12, 1]]);

  const sweep = add("rect", "brand-energy-sweep", "品牌能量扫光", 960, 536, 920, 4, goldLight);
  animate(sweep, "opacity", [[0.45, 0], [0.72, 0.96], [1.18, 0]]);
  animate(sweep, "x", [[0.45, -760], [1.18, 760]]);
  animate(sweep, "scale", [[0.45, 0.55], [0.72, 1], [1.18, 0.35]]);

  const wordmark = text("brand-wordmark", "金帧品牌字标", "金帧", 1190, 468, 760, 180, 150, white, 700);
  animate(wordmark, "opacity", [[0.62, 0], [0.98, 1], [1.22, 1], [DEMO_DURATION, 0.96, "linear"]]);
  animate(wordmark, "x", [[0.62, 82], [1.26, 0]]);
  animate(wordmark, "scale", [[0.62, 0.92], [1.3, 1]]);
  animate(wordmark, "scaleY", [[0.62, 0.92], [1.3, 1]]);
  animate(wordmark, "fill", [[1.28, colorToNumber(white)], [4.9, colorToNumber(goldLight)]]);

  const roman = text("brand-roman", "Kairo 英文标识", "K A I R O", 1190, 584, 760, 84, 58, goldLight, 500);
  animate(roman, "opacity", [[0.84, 0], [1.36, 0.96], [DEMO_DURATION, 0.74, "linear"]]);
  animate(roman, "y", [[0.84, 32], [1.42, 0]]);
  animate(roman, "scale", [[0.84, 0.86], [1.42, 1]]);
  animate(roman, "scaleY", [[0.84, 0.86], [1.42, 1]]);

  const taglineLead = text("brand-tagline-lead", "广告语前句", "让创意，", 806, 714, 430, 82, 62, white, 500);
  animate(taglineLead, "opacity", [[1.52, 0], [2.05, 1], [DEMO_DURATION, 0.92, "linear"]]);
  animate(taglineLead, "x", [[1.52, -38], [2.08, 0]]);
  const taglineEmphasis = text("brand-tagline-emphasis", "广告语重点", "逐帧成光", 1134, 714, 520, 82, 66, goldLight, 700);
  animate(taglineEmphasis, "opacity", [[1.78, 0], [2.26, 1], [DEMO_DURATION, 0.92, "linear"]]);
  animate(taglineEmphasis, "x", [[1.78, 44], [2.3, 0]]);
  animate(taglineEmphasis, "scale", [[1.78, 0.88], [2.3, 1]]);
  animate(taglineEmphasis, "scaleY", [[1.78, 0.88], [2.3, 1]]);

  const descriptor = text("brand-descriptor", "产品说明", "从一个关键帧，到一段完整动画", 960, 804, 960, 48, 28, muted, 400);
  animate(descriptor, "opacity", [[2.12, 0], [2.7, 0.88], [DEMO_DURATION, 0.7, "linear"]]);
  animate(descriptor, "y", [[2.12, 22], [2.72, 0]]);

  const underline = add("rect", "brand-underline", "广告语强调线", 960, 862, 620, 3, gold);
  animate(underline, "opacity", [[2.1, 0], [2.72, 0.9], [DEMO_DURATION, 0.46, "linear"]]);
  animate(underline, "scale", [[2.1, 0.015], [2.72, 1], [DEMO_DURATION, 0.74, "linear"]]);

  const footer = text("brand-footer", "品牌页脚", "KAIRO  ·  DESIGN IN MOTION", 960, 944, 760, 38, 22, "#728091", 500);
  animate(footer, "opacity", [[2.44, 0], [3.05, 0.72], [DEMO_DURATION, 0.58, "linear"]]);

  const sparkleSpecs = [
    { id: "spark-a", x: 408, y: 418, dx: 146, dy: 36, size: 14, color: goldLight, start: 0.42 },
    { id: "spark-b", x: 482, y: 620, dx: 128, dy: -42, size: 10, color: blue, start: 0.58 },
    { id: "spark-c", x: 1452, y: 394, dx: -176, dy: 82, size: 12, color: blue, start: 0.76 },
    { id: "spark-d", x: 1516, y: 666, dx: -154, dy: -66, size: 16, color: gold, start: 0.91 },
    { id: "spark-e", x: 805, y: 353, dx: 92, dy: 116, size: 9, color: goldLight, start: 1.02 },
    { id: "spark-f", x: 1280, y: 760, dx: -88, dy: -82, size: 11, color: blue, start: 1.16 },
  ];
  for (const [index, spec] of sparkleSpecs.entries()) {
    const spark = add("circle", spec.id, `能量粒子 ${index + 1}`, spec.x, spec.y, spec.size, spec.size, spec.color);
    animate(spark, "opacity", [[spec.start, 0], [spec.start + 0.24, 1], [spec.start + 0.62, 0.12]]);
    animate(spark, "x", [[spec.start, spec.dx], [spec.start + 0.58, 0]]);
    animate(spark, "y", [[spec.start, spec.dy], [spec.start + 0.58, 0]]);
    animate(spark, "scale", [[spec.start, 0.1], [spec.start + 0.3, 1.25], [spec.start + 0.62, 0.2]]);
    animate(spark, "scaleY", [[spec.start, 0.1], [spec.start + 0.3, 1.25], [spec.start + 0.62, 0.2]]);
  }

  const horizonBeam = add("rect", "brand-horizon-beam", "底部蓝色光带", 960, 890, 940, 3, blue);
  animate(horizonBeam, "opacity", [[2.16, 0], [2.72, 0.72], [3.3, 0.24], [DEMO_DURATION, 0.18, "linear"]]);
  animate(horizonBeam, "scale", [[2.16, 0.02], [2.82, 1], [DEMO_DURATION, 0.82, "linear"]]);

  const cornerLabel = text("brand-corner-label", "签名", "FRAME YOUR IDEAS", 350, 942, 360, 34, 18, "#66778a", 500);
  animate(cornerLabel, "opacity", [[2.62, 0], [3.22, 0.74], [DEMO_DURATION, 0.54, "linear"]]);

  for (const layer of layers) {
    layer.rest = {
      ...layer.rest,
      fill: layer.fill === "none" ? 0 : colorToNumber(layer.fill),
      stroke: colorToNumber(layer.stroke),
      strokeWidth: layer.strokeWidth,
    };
  }

  return layers;
}

export function svgTransform(layer: Layer, t: number): string {
  const p = pose(layer, t);
  const cx = layer.x + layer.w / 2;
  const cy = layer.y + layer.h / 2;
  return `translate(${p.dx} ${p.dy}) translate(${cx} ${cy}) rotate(${p.rotate}) scale(${p.scale} ${p.scaleY}) translate(${-cx} ${-cy})`;
}

export function buildExport(
  layers: Layer[],
  duration: number,
  dimensions: ExportDimensions = {
    projectWidth: 800,
    projectHeight: 500,
    exportWidth: 800,
    exportHeight: 500,
  },
  motionBlur: MotionBlurSettings = { enabled: false, strength: 6 },
  transparentBackground = false,
): string {
  const step = 1 / 15;
  let css = "";
  const parts: string[] = [];
  const filters: string[] = [];
  const motionFilters = new Map<string, string>();
  for (const layer of layers) {
    if (!layer.visible) continue;
    const animated = PROPS.some((p) => layer.tracks[p].length > 0);
    if (motionBlur.enabled && animated && layer.visible) {
      const sampleTimes: number[] = [];
      for (let t = 0; t < duration; t += step) sampleTimes.push(t);
      if (sampleTimes.length === 0 || sampleTimes.at(-1)! < duration) sampleTimes.push(duration);
      const vectors = sampleTimes.map((t) =>
        motionBlurVector(layer, t, duration, motionBlur.strength),
      );
      if (vectors.some((vector) => vector.x > 0.15 || vector.y > 0.15)) {
        const id = `motion-blur-${layer.id}`;
        motionFilters.set(layer.id, id);
        const maxBlur = {
          x: Math.max(...vectors.map((vector) => vector.x)),
          y: Math.max(...vectors.map((vector) => vector.y)),
        };
        const region = motionBlurFilterRegion(layer, maxBlur);
        const values = vectors.map((vector) => `${vector.x.toFixed(2)} ${vector.y.toFixed(2)}`);
        const keyTimes = sampleTimes.map((t) => (duration <= 0 ? 0 : t / duration).toFixed(4));
        filters.push(
          `<filter id="${id}" x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${values[0]}"><animate attributeName="stdDeviation" values="${values.join(";")}" keyTimes="${keyTimes.join(";")}" dur="${duration}s" repeatCount="indefinite"/></feGaussianBlur></filter>`,
        );
      }
    }
    if (!animated || !layer.visible) {
      parts.push(layerMarkup(layer, 0, false, motionFilters.get(layer.id)));
      continue;
    }
    let body = "";
    const end = Math.max(duration, step);
    for (let t = 0; t <= end + 1e-6; t += step) {
      const clamped = Math.min(t, duration);
      const pct = duration <= 0 ? 0 : (clamped / duration) * 100;
      const p = pose(layer, clamped);
      const cx = layer.x + layer.w / 2;
      const cy = layer.y + layer.h / 2;
      const fill =
        layer.fill === "none" && layer.tracks.fill.length === 0
          ? "none"
          : numberToColor(displayed(layer, "fill", clamped));
      const stroke = numberToColor(displayed(layer, "stroke", clamped));
      const strokeWidth = displayed(layer, "strokeWidth", clamped);
      body += `    ${pct.toFixed(2)}% { opacity: ${p.opacity}; fill: ${fill}; stroke: ${stroke}; stroke-width: ${strokeWidth}; transform: translate(${p.dx}px, ${p.dy}px) translate(${cx}px, ${cy}px) rotate(${p.rotate}deg) scale(${p.scale}, ${p.scaleY}) translate(${-cx}px, ${-cy}px); }\n`;
    }
    css += `@keyframes ${layer.id}_anim {\n${body}}\n`;
    css += `#${layer.id} { animation: ${layer.id}_anim ${duration}s linear infinite; transform-box: view-box; }\n`;
    parts.push(layerMarkup(layer, 0, true, motionFilters.get(layer.id)));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.exportWidth}" height="${dimensions.exportHeight}" viewBox="0 0 ${dimensions.projectWidth} ${dimensions.projectHeight}">
  ${filters.length ? `<defs>${filters.join("\n    ")}</defs>` : ""}
  <style>
    /* 金帧 Kairo — 关键帧烘焙为 CSS */
${css}
  </style>
  ${transparentBackground ? "" : '<rect width="100%" height="100%" fill="#121418"/>'}
  ${parts.join("\n  ")}
</svg>`;
}

/** Build one deterministic frame for raster and video exporters. */
export function buildFrameExport(
  layers: Layer[],
  time: number,
  duration: number,
  dimensions: ExportDimensions,
  motionBlur: MotionBlurSettings = { enabled: false, strength: 6 },
  transparentBackground = false,
): string {
  const filters: string[] = [];
  const parts: string[] = [];
  for (const layer of layers) {
    if (!layer.visible) continue;
    let filterId: string | undefined;
    if (motionBlur.enabled) {
      const vector = motionBlurVector(layer, time, duration, motionBlur.strength);
      if (vector.x > 0.1 || vector.y > 0.1) {
        filterId = `motion-blur-frame-${layer.id}`;
        const region = motionBlurFilterRegion(layer, vector);
        filters.push(
          `<filter id="${filterId}" x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${vector.x.toFixed(2)} ${vector.y.toFixed(2)}"/></filter>`,
        );
      }
    }
    parts.push(layerMarkup(layer, time, false, filterId));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.exportWidth}" height="${dimensions.exportHeight}" viewBox="0 0 ${dimensions.projectWidth} ${dimensions.projectHeight}">
  ${filters.length ? `<defs>${filters.join("\n    ")}</defs>` : ""}
  ${transparentBackground ? "" : '<rect width="100%" height="100%" fill="#121418"/>'}
  ${parts.join("\n  ")}
</svg>`;
}

function layerMarkup(layer: Layer, t: number, animated: boolean, filterId?: string): string {
  const p = pose(layer, t);
  const fill =
    layer.fill === "none" && layer.tracks.fill.length === 0
      ? "none"
      : numberToColor(displayed(layer, "fill", t));
  const stroke = numberToColor(displayed(layer, "stroke", t));
  const strokeWidth = displayed(layer, "strokeWidth", t);
  const common = animated
    ? `id="${layer.id}"${filterId ? ` filter="url(#${filterId})"` : ""}`
    : `opacity="${p.opacity}" transform="${svgTransform(layer, t)}"${filterId ? ` filter="url(#${filterId})"` : ""}`;
  if (layer.kind === "image") {
    return `<image ${common} x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}" href="${escapeXml(layer.imageSrc ?? "")}" preserveAspectRatio="none"/>`;
  }
  if (layer.kind === "circle") {
    const r = Math.min(layer.w, layer.h) / 2;
    return `<circle ${common} cx="${layer.x + layer.w / 2}" cy="${layer.y + layer.h / 2}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  }
  if (layer.kind === "ellipse") {
    return `<ellipse ${common} cx="${layer.x + layer.w / 2}" cy="${layer.y + layer.h / 2}" rx="${layer.w / 2}" ry="${layer.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  }
  if (layer.kind === "star") {
    return `<path ${common} d="${starPathData(layer.x, layer.y, layer.w, layer.h)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
  }
  if (layer.kind === "path") {
    return `<path ${common} d="${layerPathData(layer)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  if (layer.kind === "text") {
    return `<text ${common} x="${layer.x + layer.w / 2}" y="${layer.y + layer.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" font-size="${layer.fontSize}" font-weight="${layer.fontWeight ?? 600}" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">${escapeXml(layer.text)}</text>`;
  }
  return `<rect ${common} x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "\u0026amp;")
    .replaceAll("<", "\u0026lt;")
    .replaceAll(">", "\u0026gt;")
    .replaceAll('"', "\u0026quot;")
    .replaceAll("'", "\u0026apos;");
}
