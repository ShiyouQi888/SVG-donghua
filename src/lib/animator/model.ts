export const FPS = 30;
export const PROPS = [
  "opacity",
  "x",
  "y",
  "rotate",
  "scale",
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
] as const satisfies readonly PropKey[];
export const STYLE_PROPS = ["fill", "stroke", "strokeWidth"] as const satisfies readonly PropKey[];
export const COLOR_PROPS = ["fill", "stroke"] as const;
export type ColorPropKey = (typeof COLOR_PROPS)[number];
export type Interp = "linear" | "hold" | "ease" | "bezier";
export type BezierCurve = { x1: number; y1: number; x2: number; y2: number };
export type ShapeKind = "rect" | "circle" | "ellipse" | "text" | "image";
export type Tool = "select" | Exclude<ShapeKind, "image">;

export const PROP_LABEL: Record<PropKey, string> = {
  opacity: "透明度",
  x: "位置 X",
  y: "位置 Y",
  rotate: "旋转",
  scale: "缩放",
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
};

export const DEFAULT_BEZIER: BezierCurve = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };

export type Layer = {
  id: string;
  kind: ShapeKind;
  name: string;
  visible: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text: string;
  fontSize: number;
  imageSrc?: string;
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
    fill: on,
    stroke: on,
    strokeWidth: on,
  };
}

export function defaultRest(): Record<PropKey, number> {
  return { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1, fill: 0, stroke: 0, strokeWidth: 2 };
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

export function displayed(layer: Layer, prop: PropKey, t: number): number {
  const color = prop === "fill" || prop === "stroke";
  const fallback =
    prop === "fill"
      ? (layer.rest.fill ?? colorToNumber(layer.fill))
      : prop === "stroke"
        ? (layer.rest.stroke ?? colorToNumber(layer.stroke))
        : (layer.rest[prop] ?? defaultRest()[prop]);
  const v = sample(layer.tracks[prop], t, fallback, color);
  if (prop === "x") return layer.x + v;
  if (prop === "y") return layer.y + v;
  return v;
}

export function pose(layer: Layer, t: number) {
  return {
    opacity: displayed(layer, "opacity", t),
    dx: sample(layer.tracks.x, t, layer.rest.x),
    dy: sample(layer.tracks.y, t, layer.rest.y),
    rotate: displayed(layer, "rotate", t),
    scale: displayed(layer, "scale", t),
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
      const scaledY = (y - centerY) * current.scale;
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
    image: "图片",
  };
  const fill = kind === "text" ? "#e7ebf2" : "#4c9fff";
  const stroke = "#e7ebf2";
  const strokeWidth = kind === "text" ? 0 : 2;
  return {
    id: nid("el"),
    kind,
    name: `${names[kind]} ${n}`,
    visible: true,
    fill,
    stroke,
    strokeWidth,
    text: "金帧",
    fontSize: 28,
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

export function demoLayers(): Layer[] {
  const badge = makeLayer("rect", 250, 210, 1);
  badge.id = "demo-badge";
  badge.name = "徽标";
  badge.fill = "#4c9fff";
  badge.w = 168;
  badge.h = 96;
  badge.x = 150;
  badge.y = 150;
  badge.armed = { ...emptyArmed(false), opacity: true, scale: true };
  badge.tracks.opacity = [
    key("demo-badge-opacity-0", 0, 0, "ease"),
    key("demo-badge-opacity-1", 0.7, 1, "ease"),
  ];
  badge.tracks.scale = [
    key("demo-badge-scale-0", 0, 0.35, "ease"),
    key("demo-badge-scale-1", 0.8, 1, "ease"),
  ];

  const orb = makeLayer("circle", 520, 220, 2);
  orb.id = "demo-orb";
  orb.name = "球体";
  orb.fill = "#e6b325";
  orb.stroke = "#1b2028";
  orb.x = 470;
  orb.y = 160;
  orb.armed = { ...emptyArmed(false), y: true, rotate: true };
  orb.tracks.y = [
    key("demo-orb-y-0", 0, 0, "ease"),
    key("demo-orb-y-1", 1.1, -56, "ease"),
    key("demo-orb-y-2", 2.2, 0, "ease"),
  ];
  orb.tracks.rotate = [
    key("demo-orb-rotate-0", 0, 0, "linear"),
    key("demo-orb-rotate-1", 2.5, 360, "linear"),
  ];

  const label = makeLayer("text", 400, 390, 3);
  label.id = "demo-title";
  label.name = "标题";
  label.x = 280;
  label.y = 340;
  label.w = 240;
  label.text = "打一个 K 帧";
  label.armed = { ...emptyArmed(false), opacity: true, x: true };
  label.tracks.opacity = [
    key("demo-title-opacity-0", 0.3, 0, "ease"),
    key("demo-title-opacity-1", 1.1, 1, "ease"),
  ];
  label.tracks.x = [key("demo-title-x-0", 0.3, 36, "ease"), key("demo-title-x-1", 1.2, 0, "ease")];

  for (const layer of [badge, orb, label]) {
    layer.rest = {
      ...layer.rest,
      fill: colorToNumber(layer.fill),
      stroke: colorToNumber(layer.stroke),
      strokeWidth: layer.strokeWidth,
    };
  }

  return [badge, orb, label];
}

export function svgTransform(layer: Layer, t: number): string {
  const p = pose(layer, t);
  const cx = layer.x + layer.w / 2;
  const cy = layer.y + layer.h / 2;
  return `translate(${p.dx} ${p.dy}) translate(${cx} ${cy}) rotate(${p.rotate}) scale(${p.scale}) translate(${-cx} ${-cy})`;
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
): string {
  const step = 1 / 15;
  let css = "";
  const parts: string[] = [];
  const filters: string[] = [];
  const motionFilters = new Map<string, string>();
  for (const layer of layers) {
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
        const values = vectors.map((vector) => `${vector.x.toFixed(2)} ${vector.y.toFixed(2)}`);
        const keyTimes = sampleTimes.map((t) => (duration <= 0 ? 0 : t / duration).toFixed(4));
        filters.push(
          `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${values[0]}"><animate attributeName="stdDeviation" values="${values.join(";")}" keyTimes="${keyTimes.join(";")}" dur="${duration}s" repeatCount="indefinite"/></feGaussianBlur></filter>`,
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
      const fill = numberToColor(displayed(layer, "fill", clamped));
      const stroke = numberToColor(displayed(layer, "stroke", clamped));
      const strokeWidth = displayed(layer, "strokeWidth", clamped);
      body += `    ${pct.toFixed(2)}% { opacity: ${p.opacity}; fill: ${fill}; stroke: ${stroke}; stroke-width: ${strokeWidth}; transform: translate(${p.dx}px, ${p.dy}px) translate(${cx}px, ${cy}px) rotate(${p.rotate}deg) scale(${p.scale}) translate(${-cx}px, ${-cy}px); }\n`;
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
  <rect width="100%" height="100%" fill="#121418"/>
  ${parts.join("\n  ")}
</svg>`;
}

function layerMarkup(layer: Layer, t: number, animated: boolean, filterId?: string): string {
  const p = pose(layer, t);
  const fill = numberToColor(displayed(layer, "fill", t));
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
  if (layer.kind === "text") {
    return `<text ${common} x="${layer.x + layer.w / 2}" y="${layer.y + layer.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" font-size="${layer.fontSize}" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">${escapeXml(layer.text)}</text>`;
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
