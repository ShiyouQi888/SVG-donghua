import { create } from "zustand";
import {
  type Interp,
  type Keyframe,
  type Layer,
  type MotionTangent,
  type PersistedDoc,
  type PropKey,
  type FrameRate,
  type ShapeKind,
  type Tool,
  type VectorPathPoint,
  DEFAULT_FPS,
  PROPS,
  colorToNumber,
  defaultRest,
  DEFAULT_BEZIER,
  DEMO_DURATION,
  DEMO_HEIGHT,
  DEMO_WIDTH,
  demoLayers,
  displayed,
  emptyArmed,
  emptyTracks,
  keyNear,
  layerClipRange,
  makeLayer,
  nid,
  normalizeFrameRate,
  numberToColor,
  sample,
  snapTime,
} from "./model";

const STORAGE_KEY = "kairo-doc-v1";

export type SelectedKey = { layerId: string; prop: PropKey; id: string };
export type KeyframeMove = SelectedKey & { t: number };
export type CopiedKeyframe = {
  layerId: string;
  prop: PropKey;
  offset: number;
  v: number;
  interp: Interp;
  bezier: Keyframe["bezier"];
  motionIn?: MotionTangent;
  motionOut?: MotionTangent;
};

type DocState = {
  duration: number;
  fps: FrameRate;
  loop: boolean;
  time: number;
  playing: boolean;
  pxPerSec: number;
  projectWidth: number;
  projectHeight: number;
  exportWidth: number;
  exportHeight: number;
  safeArea: boolean;
  snapEnabled: boolean;
  motionBlur: boolean;
  motionBlurStrength: number;
  selectedId: string | null;
  selectedKey: SelectedKey | null;
  selectedKeys: SelectedKey[];
  tool: Tool;
  autoKey: boolean;
  expanded: Record<string, boolean>;
  layers: Layer[];
  seq: number;
  undoCount: number;
  redoCount: number;
};

type Actions = {
  setTime: (t: number) => void;
  togglePlay: () => void;
  toggleLoop: () => void;
  stop: () => void;
  setDuration: (d: number) => void;
  setFps: (fps: number) => void;
  setProjectSize: (width: number, height: number) => void;
  setExportSize: (width: number, height: number) => void;
  toggleSafeArea: () => void;
  toggleSnap: () => void;
  toggleMotionBlur: () => void;
  setMotionBlurStrength: (strength: number) => void;
  setPx: (n: number) => void;
  setTool: (tool: Tool) => void;
  toggleAutoKey: () => void;
  selectLayer: (id: string | null) => void;
  toggleExpanded: (id: string) => void;
  addShape: (
    kind: Exclude<ShapeKind, "path">,
    x: number,
    y: number,
    bounds?: { x: number; y: number; w: number; h: number },
  ) => void;
  addPath: (points: VectorPathPoint[], closed?: boolean) => void;
  setPathPoint: (id: string, index: number, point: VectorPathPoint) => void;
  moveLayer: (id: string, direction: "forward" | "backward" | "front" | "back") => void;
  moveLayerToRow: (id: string, targetId: string, placement: "before" | "after") => void;
  moveLayerClip: (id: string, deltaFrames: number) => void;
  setLayerClipRange: (id: string, inPoint: number, outPoint: number) => void;
  setMotionHandle: (id: string, keyId: string, side: "in" | "out", offset: MotionTangent) => void;
  deleteLayer: (id: string) => void;
  toggleVisible: (id: string) => void;
  rename: (id: string, name: string) => void;
  setPaint: (
    id: string,
    patch: Partial<
      Pick<
        Layer,
        | "fill"
        | "stroke"
        | "strokeWidth"
        | "text"
        | "fontSize"
        | "fontWeight"
        | "fontFamily"
        | "cornerRadius"
        | "imageSrc"
        | "x"
        | "y"
        | "w"
        | "h"
      >
    >,
  ) => void;
  setTrack: (id: string, prop: PropKey, track: Keyframe[]) => void;
  setDisplayed: (id: string, prop: PropKey, absolute: number, forceKey?: boolean) => void;
  toggleScaleLinked: (id: string) => void;
  moveBy: (
    id: string,
    dx: number,
    dy: number,
    origin: { x: number; y: number; ox: number; oy: number },
  ) => void;
  toggleArm: (id: string, prop: PropKey) => void;
  toggleKey: (id: string, prop: PropKey) => void;
  punchKeys: (id: string) => void;
  stepProp: (id: string, prop: PropKey, dir: -1 | 1) => void;
  stepAny: (dir: -1 | 1) => void;
  selectKey: (sel: SelectedKey | null, extend?: boolean) => void;
  selectKeys: (keys: SelectedKey[]) => void;
  moveKeys: (keys: KeyframeMove[], delta: number) => void;
  pasteKeyframes: (keys: CopiedKeyframe[], atTime: number) => void;
  setSelectedInterpolation: (interp: Interp) => void;
  beginUndoGroup: () => void;
  endUndoGroup: () => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
  moveKey: (id: string, prop: PropKey, keyId: string, t: number) => void;
  patchKey: (
    id: string,
    prop: PropKey,
    keyId: string,
    patch: Partial<
      Pick<Keyframe, "v" | "t" | "interp" | "bezier" | "motionIn" | "motionOut">
    >,
  ) => void;
  deleteSelectedKey: () => void;
  easyEase: () => void;
  resetDemo: () => void;
  clearAll: () => void;
  replace: (doc: PersistedDoc) => void;
  snapshot: () => PersistedDoc;
};

type HistoryFrame = Pick<
  DocState,
  | "duration"
  | "fps"
  | "pxPerSec"
  | "projectWidth"
  | "projectHeight"
  | "exportWidth"
  | "exportHeight"
  | "safeArea"
  | "snapEnabled"
  | "motionBlur"
  | "motionBlurStrength"
  | "time"
  | "selectedId"
  | "selectedKey"
  | "selectedKeys"
  | "expanded"
  | "layers"
  | "seq"
>;

const undoPast: HistoryFrame[] = [];
const undoFuture: HistoryFrame[] = [];
let undoGroupDepth = 0;
let undoGroupRecorded = false;
let applyingHistory = false;

function historyFrame(state: DocState): HistoryFrame {
  return {
    duration: state.duration,
    fps: state.fps,
    pxPerSec: state.pxPerSec,
    projectWidth: state.projectWidth,
    projectHeight: state.projectHeight,
    exportWidth: state.exportWidth,
    exportHeight: state.exportHeight,
    safeArea: state.safeArea,
    snapEnabled: state.snapEnabled,
    motionBlur: state.motionBlur,
    motionBlurStrength: state.motionBlurStrength,
    time: state.time,
    selectedId: state.selectedId,
    selectedKey: state.selectedKey,
    selectedKeys: state.selectedKeys,
    expanded: state.expanded,
    layers: state.layers,
    seq: state.seq,
  };
}

function hasDocumentChange(next: DocState, previous: DocState): boolean {
  return (
    next.duration !== previous.duration ||
    next.fps !== previous.fps ||
    next.projectWidth !== previous.projectWidth ||
    next.projectHeight !== previous.projectHeight ||
    next.exportWidth !== previous.exportWidth ||
    next.exportHeight !== previous.exportHeight ||
    next.safeArea !== previous.safeArea ||
    next.snapEnabled !== previous.snapEnabled ||
    next.motionBlur !== previous.motionBlur ||
    next.motionBlurStrength !== previous.motionBlurStrength ||
    next.layers !== previous.layers
  );
}

function pushUndoFrame(frame: HistoryFrame) {
  undoPast.push(frame);
  if (undoPast.length > 100) undoPast.shift();
}

function sortTrack(track: Keyframe[]): Keyframe[] {
  return [...track].sort((a, b) => a.t - b.t);
}

function upsert(
  track: Keyframe[],
  t: number,
  v: number,
  interp: Interp = "ease",
  fps = DEFAULT_FPS,
): Keyframe[] {
  const hit = keyNear(track, t, fps);
  if (hit) {
    return sortTrack(track.map((k) => (k.id === hit.id ? { ...k, t, v } : k)));
  }
  return sortTrack([...track, { id: nid("k"), t, v, interp, bezier: { ...DEFAULT_BEZIER } }]);
}

function mapLayer(layers: Layer[], id: string, fn: (layer: Layer) => Layer): Layer[] {
  return layers.map((layer) => (layer.id === id ? fn(layer) : layer));
}

function safeDimension(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(8192, Math.max(1, Math.round(value))) : fallback;
}

function safeBlurStrength(value: number): number {
  return Number.isFinite(value) ? Math.min(12, Math.max(0, value)) : 6;
}

function normalizeTrackFrameRate(track: Keyframe[], duration: number, fps: number): Keyframe[] {
  const result: Keyframe[] = [];
  for (const key of sortTrack(track).map((item) => ({ ...item, t: snapTime(item.t, duration, fps) }))) {
    const previous = result.at(-1);
    if (previous && Math.abs(previous.t - key.t) < 0.5 / fps) result[result.length - 1] = key;
    else result.push(key);
  }
  return result;
}

function isColorProp(prop: PropKey): prop is "fill" | "stroke" {
  return prop === "fill" || prop === "stroke";
}

function setBaseValue(layer: Layer, prop: PropKey, value: number): Layer {
  const rest = { ...layer.rest, [prop]: value };
  if (prop === "fill") return { ...layer, fill: numberToColor(value), rest };
  if (prop === "stroke") return { ...layer, stroke: numberToColor(value), rest };
  if (prop === "strokeWidth") return { ...layer, strokeWidth: value, rest };
  return { ...layer, rest };
}

function hydrateLayer(layer: Layer): Layer {
  const rest = { ...defaultRest(), ...(layer.rest ?? {}) };
  if (layer.rest?.fill === undefined) rest.fill = colorToNumber(layer.fill);
  if (layer.rest?.stroke === undefined) rest.stroke = colorToNumber(layer.stroke);
  if (layer.rest?.strokeWidth === undefined) rest.strokeWidth = layer.strokeWidth;
  const tracks = { ...emptyTracks(), ...(layer.tracks ?? {}) };
  if (layer.scaleLinked === undefined && tracks.scale.length > 0 && tracks.scaleY.length === 0) {
    tracks.scaleY = tracks.scale.map((key) => ({
      ...key,
      id: nid("ky"),
      bezier: { ...key.bezier },
    }));
  }
  return {
    ...layer,
    timelineOffset: Number.isFinite(layer.timelineOffset) ? layer.timelineOffset : undefined,
    scaleLinked: layer.scaleLinked ?? true,
    cornerRadius: layer.cornerRadius ?? 8,
    fontFamily: layer.fontFamily ?? "IBM Plex Sans, Source Han Sans SC, sans-serif",
    armed: { ...emptyArmed(false), ...(layer.armed ?? {}) },
    tracks,
    rest,
  };
}

function writeProp(
  layer: Layer,
  prop: PropKey,
  absolute: number,
  time: number,
  autoKey: boolean,
  fps: number,
): Layer {
  const next: Layer = {
    ...layer,
    armed: { ...layer.armed },
    tracks: { ...layer.tracks, [prop]: [...layer.tracks[prop]] },
    rest: { ...layer.rest },
  };
  const shouldKey = next.armed[prop] || autoKey;
  if (prop === "fill" || prop === "stroke" || prop === "strokeWidth") {
    if (shouldKey) {
      next.armed[prop] = true;
      next.tracks[prop] = upsert(next.tracks[prop], snapTime(time, 999, fps), absolute, "ease", fps);
      return next;
    }
    return setBaseValue(next, prop, absolute);
  }
  if (prop === "x" || prop === "y") {
    const base = prop === "x" ? next.x : next.y;
    const offset = absolute - base;
    if (shouldKey) {
      next.armed[prop] = true;
      next.tracks[prop] = upsert(next.tracks[prop], snapTime(time, 999, fps), offset, "ease", fps);
    } else if (prop === "x") {
      next.x = absolute;
      next.rest.x = 0;
    } else {
      next.y = absolute;
      next.rest.y = 0;
    }
    return next;
  }
  if (shouldKey) {
    next.armed[prop] = true;
    next.tracks[prop] = upsert(next.tracks[prop], snapTime(time, 999, fps), absolute, "ease", fps);
  } else {
    next.rest[prop] = absolute;
  }
  return next;
}

const initialLayers = demoLayers();

export const useDoc = create<DocState & Actions>((set, get) => ({
  duration: DEMO_DURATION,
  fps: DEFAULT_FPS,
  loop: true,
  time: 0,
  playing: true,
  pxPerSec: 120,
  projectWidth: DEMO_WIDTH,
  projectHeight: DEMO_HEIGHT,
  exportWidth: DEMO_WIDTH,
  exportHeight: DEMO_HEIGHT,
  safeArea: false,
  snapEnabled: true,
  motionBlur: false,
  motionBlurStrength: 6,
  selectedId: null,
  selectedKey: null,
  selectedKeys: [],
  tool: "select",
  autoKey: false,
  expanded: Object.fromEntries(initialLayers.map((l) => [l.id, false])),
  layers: initialLayers,
  seq: initialLayers.length,
  undoCount: 0,
  redoCount: 0,

  setTime: (t) => set({ time: Math.min(get().duration, Math.max(0, t)) }),
  togglePlay: () => {
    const { playing, time, duration, fps } = get();
    if (!playing && time >= duration - 1 / fps) set({ time: 0, playing: true });
    else set({ playing: !playing });
  },
  toggleLoop: () => set({ loop: !get().loop }),
  stop: () => set({ playing: false, time: 0 }),
  setDuration: (d) => {
    const duration = Number.isFinite(d) ? Math.min(30, Math.max(0.5, d)) : get().duration;
    const fps = get().fps;
    const latestIn = Math.max(0, Math.floor(duration * fps + 1e-6) - 1) / fps;
    set({
      duration,
      time: Math.min(get().time, duration),
      layers: get().layers.map((layer) => {
        const tracks = { ...layer.tracks };
        for (const prop of PROPS) {
          tracks[prop] = layer.tracks[prop].map((k) => ({ ...k, t: Math.min(k.t, duration) }));
        }
        const clipIn = layer.clipIn === undefined ? undefined : Math.min(layer.clipIn, latestIn);
        const clipOut = layer.clipOut === undefined ? undefined : Math.min(layer.clipOut, duration);
        const safeIn =
          clipIn !== undefined && clipOut !== undefined && clipOut < clipIn + 1 / fps
            ? Math.max(0, clipOut - 1 / fps)
            : clipIn;
        return { ...layer, clipIn: safeIn, clipOut, tracks };
      }),
    });
  },
  setFps: (requestedFps) => {
    const state = get();
    const fps = normalizeFrameRate(requestedFps, state.fps);
    if (fps === state.fps) return;
    const layers = state.layers.map((layer) => {
      const tracks = { ...layer.tracks };
      for (const prop of PROPS) tracks[prop] = normalizeTrackFrameRate(layer.tracks[prop], state.duration, fps);
      return { ...layer, tracks };
    });
    set({
      fps,
      layers,
      time: snapTime(state.time, state.duration, fps),
      selectedKey: null,
      selectedKeys: [],
    });
  },
  setProjectSize: (width, height) => {
    const state = get();
    const projectWidth = safeDimension(width, state.projectWidth);
    const projectHeight = safeDimension(height, state.projectHeight);
    set({
      projectWidth,
      projectHeight,
      exportWidth: state.exportWidth === state.projectWidth ? projectWidth : state.exportWidth,
      exportHeight: state.exportHeight === state.projectHeight ? projectHeight : state.exportHeight,
    });
  },
  setExportSize: (width, height) => {
    const state = get();
    set({
      exportWidth: safeDimension(width, state.exportWidth),
      exportHeight: safeDimension(height, state.exportHeight),
    });
  },
  toggleSafeArea: () => set({ safeArea: !get().safeArea }),
  toggleSnap: () => set({ snapEnabled: !get().snapEnabled }),
  toggleMotionBlur: () => set({ motionBlur: !get().motionBlur }),
  setMotionBlurStrength: (strength) => set({ motionBlurStrength: safeBlurStrength(strength) }),
  setPx: (n) => set({ pxPerSec: Math.min(480, Math.max(40, n)) }),
  setTool: (tool) => set({ tool }),
  toggleAutoKey: () => set({ autoKey: !get().autoKey }),
  selectLayer: (id) =>
    set({
      selectedId: id,
      selectedKey: null,
      selectedKeys: [],
      expanded: id ? { ...get().expanded, [id]: true } : get().expanded,
    }),
  toggleExpanded: (id) => set({ expanded: { ...get().expanded, [id]: !get().expanded[id] } }),
  addShape: (kind, x, y, bounds) => {
    const seq = get().seq + 1;
    const layer = makeLayer(kind, x, y, seq);
    if (bounds) Object.assign(layer, bounds);
    set({
      seq,
      layers: [...get().layers, layer],
      selectedId: layer.id,
      expanded: { ...get().expanded, [layer.id]: true },
      tool: "select",
      selectedKey: null,
      selectedKeys: [],
    });
  },
  addPath: (points, closed = false) => {
    if (points.length < 2) return;
    const xValues = points.flatMap((point) => [point.x, point.inX, point.outX]);
    const yValues = points.flatMap((point) => [point.y, point.inY, point.outY]);
    const left = Math.min(...xValues);
    const right = Math.max(...xValues);
    const top = Math.min(...yValues);
    const bottom = Math.max(...yValues);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const seq = get().seq + 1;
    const layer = makeLayer("path", left + width / 2, top + height / 2, seq);
    layer.name = `钢笔路径 ${seq}`;
    layer.x = left;
    layer.y = top;
    layer.w = width;
    layer.h = height;
    layer.path = points.map((point) => ({
      x: (point.x - left) / width,
      y: (point.y - top) / height,
      inX: (point.inX - left) / width,
      inY: (point.inY - top) / height,
      outX: (point.outX - left) / width,
      outY: (point.outY - top) / height,
    }));
    layer.closed = closed;
    layer.fill = closed ? "#4c9fff" : "none";
    layer.stroke = "#e7ebf2";
    layer.strokeWidth = 2;
    layer.rest = {
      ...layer.rest,
      fill: closed ? colorToNumber(layer.fill) : 0,
      stroke: colorToNumber(layer.stroke),
      strokeWidth: layer.strokeWidth,
    };
    set({
      seq,
      layers: [...get().layers, layer],
      selectedId: layer.id,
      expanded: { ...get().expanded, [layer.id]: true },
      tool: "select",
      selectedKey: null,
      selectedKeys: [],
    });
  },
  moveLayer: (id, direction) => {
    const layers = [...get().layers];
    const from = layers.findIndex((layer) => layer.id === id);
    if (from < 0) return;
    const to =
      direction === "front"
        ? layers.length - 1
        : direction === "back"
          ? 0
          : Math.min(layers.length - 1, Math.max(0, from + (direction === "forward" ? 1 : -1)));
    if (from === to) return;
    const [layer] = layers.splice(from, 1);
    layers.splice(to, 0, layer);
    set({ layers });
  },
  moveLayerToRow: (id, targetId, placement) => {
    if (id === targetId) return;
    const currentLayers = get().layers;
    const rows = [...currentLayers].reverse();
    const from = rows.findIndex((layer) => layer.id === id);
    if (from < 0) return;
    const [layer] = rows.splice(from, 1);
    const targetIndex = rows.findIndex((item) => item.id === targetId);
    if (targetIndex < 0) return;
    rows.splice(targetIndex + (placement === "after" ? 1 : 0), 0, layer);
    const layers = rows.reverse();
    if (layers.every((item, index) => item.id === currentLayers[index]?.id)) return;
    set({ layers });
  },
  moveLayerClip: (id, deltaFrames) => {
    const state = get();
    const layer = state.layers.find((item) => item.id === id);
    if (!layer || !Number.isFinite(deltaFrames) || Math.round(deltaFrames) === 0) return;
    const { duration, fps } = state;
    const frame = 1 / fps;
    const currentOffset = layer.timelineOffset ?? 0;
    const range = layerClipRange(layer, duration, fps);
    const baseIn = range.inPoint - currentOffset;
    const baseOut = range.outPoint - currentOffset;
    const minOffset = -baseOut + frame;
    const maxOffset = duration - baseIn - frame;
    const requestedOffset = currentOffset + Math.round(deltaFrames) * frame;
    const nextOffset = Math.round(Math.min(maxOffset, Math.max(minOffset, requestedOffset)) * fps) / fps;
    const appliedFrames = Math.round((nextOffset - currentOffset) * fps);
    if (appliedFrames === 0) return;
    const shift = appliedFrames * frame;
    set({
      layers: mapLayer(get().layers, id, (current) => {
        const tracks = { ...current.tracks };
        for (const prop of PROPS) {
          tracks[prop] = normalizeTrackFrameRate(
            current.tracks[prop].map((key) => ({ ...key, t: key.t + shift })),
            duration,
            fps,
          );
        }
        return {
          ...current,
          timelineOffset: Math.abs(nextOffset) < 1e-6 ? undefined : nextOffset,
          tracks,
        };
      }),
    });
  },
  setLayerClipRange: (id, requestedIn, requestedOut) => {
    const state = get();
    const { duration, fps } = state;
    const layer = state.layers.find((item) => item.id === id);
    if (!layer) return;
    const frame = 1 / fps;
    const latestIn = Math.max(0, Math.floor(duration * fps + 1e-6) - 1) / fps;
    const offset = layer.timelineOffset ?? 0;
    const inPoint = Math.min(latestIn, Math.max(0, snapTime(requestedIn - offset, duration, fps)));
    const snappedOut = requestedOut - offset >= duration
      ? duration
      : snapTime(requestedOut - offset, duration, fps);
    const outPoint = Math.min(duration, Math.max(inPoint + frame, snappedOut));
    const current = layerClipRange(layer, duration, fps);
    if (
      Math.abs(current.inPoint - (offset + inPoint)) < 1e-6 &&
      Math.abs(current.outPoint - (offset + outPoint)) < 1e-6
    ) return;
    set({
      layers: mapLayer(get().layers, id, (layer) => ({
        ...layer,
        clipIn: inPoint <= 1e-6 ? undefined : inPoint,
        clipOut: outPoint >= duration - 1e-6 ? undefined : outPoint,
      })),
    });
  },
  setMotionHandle: (id, keyId, side, offset) => {
    const field = side === "in" ? "motionIn" : "motionOut";
    set({
      layers: mapLayer(get().layers, id, (layer) => {
        const xHasKey = layer.tracks.x.some((key) => key.id === keyId);
        const prop: PropKey = xHasKey ? "x" : "y";
        return {
          ...layer,
          tracks: {
            ...layer.tracks,
            [prop]: layer.tracks[prop].map((key) =>
              key.id === keyId ? { ...key, [field]: { ...offset } } : key,
            ),
          },
        };
      }),
    });
  },
  setPathPoint: (id, index, point) => {
    set({
      layers: mapLayer(get().layers, id, (layer) => {
        if (!layer.path || !layer.path[index]) return layer;
        const path = layer.path.map((existing, pointIndex) =>
          pointIndex === index ? { ...point } : existing,
        );
        return { ...layer, path };
      }),
    });
  },
  deleteLayer: (id) => {
    const layers = get().layers.filter((l) => l.id !== id);
    set({
      layers,
      selectedId: get().selectedId === id ? (layers.at(-1)?.id ?? null) : get().selectedId,
      selectedKey: get().selectedKey?.layerId === id ? null : get().selectedKey,
      selectedKeys: get().selectedKeys.filter((key) => key.layerId !== id),
    });
  },
  toggleVisible: (id) =>
    set({ layers: mapLayer(get().layers, id, (l) => ({ ...l, visible: !l.visible })) }),
  rename: (id, name) => set({ layers: mapLayer(get().layers, id, (l) => ({ ...l, name })) }),
  setPaint: (id, patch) =>
    set({
      layers: mapLayer(get().layers, id, (layer) => {
        const next = { ...layer, ...patch, rest: { ...layer.rest } };
        if (patch.fill !== undefined) next.rest.fill = colorToNumber(patch.fill);
        if (patch.stroke !== undefined) next.rest.stroke = colorToNumber(patch.stroke);
        if (patch.strokeWidth !== undefined) next.rest.strokeWidth = patch.strokeWidth;
        return next;
      }),
    }),
  setTrack: (id, prop, track) => {
    const ids = new Set(track.map((key) => key.id));
    const selectedKey = get().selectedKey;
    set({
      layers: mapLayer(get().layers, id, (layer) => ({
        ...layer,
        tracks: { ...layer.tracks, [prop]: [...track].sort((a, b) => a.t - b.t) },
      })),
      selectedKeys: get().selectedKeys.filter(
        (key) => key.layerId !== id || key.prop !== prop || ids.has(key.id),
      ),
      selectedKey:
        selectedKey?.layerId === id && selectedKey.prop === prop && !ids.has(selectedKey.id)
          ? null
          : selectedKey,
    });
  },
  setDisplayed: (id, prop, absolute, forceKey = false) => {
    const { time, autoKey, duration, fps } = get();
    set({
      layers: mapLayer(get().layers, id, (layer) => {
        const written = writeProp(layer, prop, absolute, time, autoKey || forceKey, fps);
        const tracks = { ...written.tracks };
        tracks[prop] = tracks[prop].map((k) => ({ ...k, t: Math.min(k.t, duration) }));
        return { ...written, tracks };
      }),
    });
  },
  toggleScaleLinked: (id) =>
    set({
      layers: mapLayer(get().layers, id, (layer) => ({
        ...layer,
        scaleLinked: !(layer.scaleLinked ?? true),
      })),
    }),
  moveBy: (id, dx, dy, origin) => {
    const { time, autoKey, fps } = get();
    set({
      layers: mapLayer(get().layers, id, (layer) => {
        let next = layer;
        const armX = layer.armed.x || autoKey;
        const armY = layer.armed.y || autoKey;
        if (armX) next = writeProp(next, "x", origin.x + origin.ox + dx, time, true, fps);
        else next = { ...next, x: origin.x + dx, rest: { ...next.rest, x: 0 } };
        if (armY) next = writeProp(next, "y", origin.y + origin.oy + dy, time, true, fps);
        else next = { ...next, y: origin.y + dy, rest: { ...next.rest, y: 0 } };
        return next;
      }),
    });
  },
  toggleArm: (id, prop) => {
    const { time, duration, fps } = get();
    set({
      layers: mapLayer(get().layers, id, (layer) => {
        if (layer.armed[prop]) {
          const current = sample(layer.tracks[prop], time, layer.rest[prop], isColorProp(prop));
          const next = {
            ...layer,
            armed: { ...layer.armed, [prop]: false },
            tracks: { ...layer.tracks, [prop]: [] },
            rest: { ...layer.rest, [prop]: current },
          };
          if (prop === "fill") next.fill = numberToColor(current);
          else if (prop === "stroke") next.stroke = numberToColor(current);
          else if (prop === "strokeWidth") next.strokeWidth = current;
          return next;
        }
        const current = sample(layer.tracks[prop], time, layer.rest[prop], isColorProp(prop));
        return {
          ...layer,
          armed: { ...layer.armed, [prop]: true },
          tracks: {
            ...layer.tracks,
            [prop]: layer.tracks[prop].length
              ? layer.tracks[prop]
              : upsert([], snapTime(time, duration, fps), current, "ease", fps),
          },
        };
      }),
    });
  },
  toggleKey: (id, prop) => {
    const { duration, fps } = get();
    const time = snapTime(get().time, duration, fps);
    set({
      layers: mapLayer(get().layers, id, (layer) => {
        const hit = keyNear(layer.tracks[prop], time, fps);
        if (hit) {
          const track = layer.tracks[prop].filter((k) => k.id !== hit.id);
          if (track.length === 0) {
            const current = hit.v;
            const next = {
              ...layer,
              armed: { ...layer.armed, [prop]: false },
              tracks: { ...layer.tracks, [prop]: [] },
              rest: { ...layer.rest, [prop]: current },
            };
            if (prop === "fill") next.fill = numberToColor(current);
            else if (prop === "stroke") next.stroke = numberToColor(current);
            else if (prop === "strokeWidth") next.strokeWidth = current;
            return next;
          }
          return { ...layer, tracks: { ...layer.tracks, [prop]: track } };
        }
        const current = sample(layer.tracks[prop], time, layer.rest[prop], isColorProp(prop));
        return {
          ...layer,
          armed: { ...layer.armed, [prop]: true },
          tracks: { ...layer.tracks, [prop]: upsert(layer.tracks[prop], time, current, "ease", fps) },
        };
      }),
      selectedKey: null,
      selectedKeys: [],
    });
  },
  punchKeys: (id) => {
    const { time: currentTime, duration, fps } = get();
    const time = snapTime(currentTime, duration, fps);
    set({
      layers: mapLayer(get().layers, id, (layer) => {
        const armedProps = PROPS.filter((p) => layer.armed[p]);
        const targets = armedProps.length ? armedProps : PROPS;
        let next = layer;
        for (const prop of targets) {
          const current =
            prop === "x" || prop === "y"
              ? sample(next.tracks[prop], time, next.rest[prop])
              : displayed(next, prop, time, fps);
          if (prop === "x")
            next = writeProp(
              { ...next, armed: { ...next.armed, x: true } },
              "x",
              next.x + current,
              time,
              true,
              fps,
            );
          else if (prop === "y")
            next = writeProp(
              { ...next, armed: { ...next.armed, y: true } },
              "y",
              next.y + current,
              time,
              true,
              fps,
            );
          else
            next = writeProp(
              { ...next, armed: { ...next.armed, [prop]: true } },
              prop,
              current,
              time,
              true,
              fps,
            );
        }
        return next;
      }),
    });
  },
  stepProp: (id, prop, dir) => {
    const { layers, fps } = get();
    const layer = layers.find((l) => l.id === id);
    if (!layer) return;
    const time = get().time;
    const track = [...layer.tracks[prop]].sort((a, b) => a.t - b.t);
    const target =
      dir < 0
        ? [...track].reverse().find((k) => k.t < time - 0.5 / fps)
        : track.find((k) => k.t > time + 0.5 / fps);
    if (target) {
      const selectedKey = { layerId: id, prop, id: target.id };
      set({ time: target.t, playing: false, selectedKey, selectedKeys: [selectedKey] });
    }
  },
  stepAny: (dir) => {
    const { selectedId, layers, time, fps } = get();
    const layer = layers.find((l) => l.id === selectedId);
    if (!layer) return;
    const keys = PROPS.flatMap((prop) => layer.tracks[prop].map((k) => ({ ...k, prop })));
    const target =
      dir < 0
        ? keys.filter((k) => k.t < time - 1 / fps).sort((a, b) => b.t - a.t)[0]
        : keys.filter((k) => k.t > time + 1 / fps).sort((a, b) => a.t - b.t)[0];
    if (target)
      set({
        time: target.t,
        playing: false,
        selectedKey: { layerId: layer.id, prop: target.prop, id: target.id },
        selectedKeys: [{ layerId: layer.id, prop: target.prop, id: target.id }],
      });
  },
  selectKey: (sel, extend = false) => {
    if (!sel) {
      set({ selectedKey: null, selectedKeys: [], playing: false });
      return;
    }
    if (!extend) {
      set({ selectedKey: sel, selectedKeys: [sel], selectedId: sel.layerId, playing: false });
      return;
    }
    const current = get().selectedKeys;
    const exists = current.some(
      (key) => key.layerId === sel.layerId && key.prop === sel.prop && key.id === sel.id,
    );
    const selectedKeys = exists ? current : [...current, sel];
    set({
      selectedKeys,
      selectedKey: selectedKeys.at(-1) ?? null,
      selectedId: sel.layerId,
      playing: false,
    });
  },
  selectKeys: (selectedKeys) => {
    const selectedKey = selectedKeys.at(-1) ?? null;
    set({
      selectedKeys,
      selectedKey,
      selectedId: selectedKey?.layerId ?? get().selectedId,
      playing: false,
    });
  },
  moveKey: (id, prop, keyId, t) => {
    const { duration, fps } = get();
    const time = snapTime(t, duration, fps);
    set({
      layers: mapLayer(get().layers, id, (layer) => {
        const without = layer.tracks[prop].filter(
          (k) => k.id !== keyId && Math.abs(k.t - time) >= 0.5 / fps,
        );
        const current = layer.tracks[prop].find((k) => k.id === keyId);
        if (!current) return layer;
        return {
          ...layer,
          tracks: { ...layer.tracks, [prop]: sortTrack([...without, { ...current, t: time }]) },
        };
      }),
    });
  },
  moveKeys: (keys, delta) => {
    if (keys.length === 0) return;
    const { duration, fps } = get();
    const minDelta = Math.max(...keys.map((key) => -key.t));
    const maxDelta = Math.min(...keys.map((key) => duration - key.t));
    const boundedDelta = Math.min(maxDelta, Math.max(minDelta, delta));
    const moves = new Map(keys.map((key) => [`${key.layerId}:${key.prop}:${key.id}`, key]));
    set({
      layers: get().layers.map((layer) => {
        const tracks = { ...layer.tracks };
        for (const prop of PROPS) {
          const selectedMoves = keys.filter((key) => key.layerId === layer.id && key.prop === prop);
          if (selectedMoves.length === 0) continue;
          const movingIds = new Set(selectedMoves.map((key) => key.id));
          const updated = layer.tracks[prop].map((key) => {
            if (!movingIds.has(key.id)) return key;
            const origin = moves.get(`${layer.id}:${prop}:${key.id}`);
            return origin ? { ...key, t: snapTime(origin.t + boundedDelta, duration, fps) } : key;
          });
          const movingTimes = new Map(
            updated.filter((key) => movingIds.has(key.id)).map((key) => [key.id, key.t]),
          );
          tracks[prop] = sortTrack(
            updated.filter((key) => {
              if (movingIds.has(key.id)) return true;
              return ![...movingTimes.values()].some((time) => Math.abs(key.t - time) < 0.5 / fps);
            }),
          );
        }
        return { ...layer, tracks };
      }),
    });
  },
  pasteKeyframes: (copied, atTime) => {
    if (copied.length === 0) return;
    const state = get();
    const sourceLayers = [...new Set(copied.map((key) => key.layerId))];
    const remapSingleLayer =
      sourceLayers.length === 1 && state.selectedId && state.selectedId !== sourceLayers[0]
        ? state.selectedId
        : null;
    const existingLayerIds = new Set(state.layers.map((layer) => layer.id));
    const pasted: SelectedKey[] = [];
    const layers = state.layers.map((layer) => {
      const targets = copied.filter((item) => {
        const targetId =
          remapSingleLayer ?? (existingLayerIds.has(item.layerId) ? item.layerId : null);
        return targetId === layer.id;
      });
      if (targets.length === 0) return layer;
      const tracks = { ...layer.tracks };
      const armed = { ...layer.armed };
      for (const item of targets) {
        const time = snapTime(atTime + item.offset, state.duration, state.fps);
        const id = nid("k");
        tracks[item.prop] = sortTrack([
          ...tracks[item.prop].filter((key) => Math.abs(key.t - time) >= 0.5 / state.fps),
          {
            id,
            t: time,
            v: item.v,
            interp: item.interp,
            bezier: { ...item.bezier },
            ...(item.motionIn ? { motionIn: { ...item.motionIn } } : {}),
            ...(item.motionOut ? { motionOut: { ...item.motionOut } } : {}),
          },
        ]);
        armed[item.prop] = true;
        pasted.push({ layerId: layer.id, prop: item.prop, id });
      }
      return { ...layer, tracks, armed };
    });
    if (pasted.length === 0) return;
    set({
      layers,
      selectedId: pasted.at(-1)?.layerId ?? state.selectedId,
      selectedKey: pasted.at(-1) ?? null,
      selectedKeys: pasted,
      playing: false,
    });
  },
  setSelectedInterpolation: (interp) => {
    const state = get();
    const selected = state.selectedKeys.length
      ? state.selectedKeys
      : state.selectedKey
        ? [state.selectedKey]
        : [];
    if (selected.length === 0) return;
    const layers = state.layers.map((layer) => {
      const tracks = { ...layer.tracks };
      let changed = false;
      for (const prop of PROPS) {
        const ids = new Set(
          selected
            .filter((key) => key.layerId === layer.id && key.prop === prop)
            .map((key) => key.id),
        );
        if (ids.size === 0) continue;
        tracks[prop] = tracks[prop].map((key) => {
          if (!ids.has(key.id)) return key;
          changed = true;
          return { ...key, interp };
        });
      }
      return changed ? { ...layer, tracks } : layer;
    });
    set({ layers });
  },
  beginUndoGroup: () => {
    if (undoGroupDepth === 0) undoGroupRecorded = false;
    undoGroupDepth += 1;
  },
  endUndoGroup: () => {
    undoGroupDepth = Math.max(0, undoGroupDepth - 1);
    if (undoGroupDepth === 0) undoGroupRecorded = false;
  },
  undo: () => {
    undoGroupDepth = 0;
    undoGroupRecorded = false;
    const frame = undoPast.pop();
    if (!frame) return;
    undoFuture.push(historyFrame(get()));
    applyingHistory = true;
    set({
      ...frame,
      playing: false,
    });
    applyingHistory = false;
    set({ undoCount: undoPast.length, redoCount: undoFuture.length });
  },
  redo: () => {
    undoGroupDepth = 0;
    undoGroupRecorded = false;
    const frame = undoFuture.pop();
    if (!frame) return;
    pushUndoFrame(historyFrame(get()));
    applyingHistory = true;
    set({
      ...frame,
      playing: false,
    });
    applyingHistory = false;
    set({ undoCount: undoPast.length, redoCount: undoFuture.length });
  },
  clearHistory: () => {
    undoPast.length = 0;
    undoFuture.length = 0;
    undoGroupDepth = 0;
    undoGroupRecorded = false;
    set({ undoCount: 0, redoCount: 0 });
  },
  patchKey: (id, prop, keyId, patch) => {
    set({
      layers: mapLayer(get().layers, id, (layer) => ({
        ...layer,
        tracks: {
          ...layer.tracks,
          [prop]: sortTrack(
            layer.tracks[prop].map((k) => {
              if (k.id !== keyId) return k;
              const state = get();
              const t = patch.t === undefined ? k.t : snapTime(patch.t, state.duration, state.fps);
              return { ...k, ...patch, t };
            }),
          ),
        },
      })),
    });
  },
  deleteSelectedKey: () => {
    const selected = get().selectedKeys.length
      ? get().selectedKeys
      : get().selectedKey
        ? [get().selectedKey!]
        : [];
    if (selected.length === 0) return;
    set({
      selectedKey: null,
      selectedKeys: [],
      layers: get().layers.map((layer) => {
        let next = layer;
        const layerSelections = selected.filter((key) => key.layerId === layer.id);
        for (const prop of PROPS) {
          const ids = new Set(
            layerSelections.filter((key) => key.prop === prop).map((key) => key.id),
          );
          if (ids.size === 0) continue;
          const gone = next.tracks[prop].filter((key) => ids.has(key.id));
          const track = next.tracks[prop].filter((key) => !ids.has(key.id));
          if (track.length === 0) {
            const value = gone.at(-1)?.v ?? next.rest[prop];
            next = setBaseValue(
              {
                ...next,
                armed: { ...next.armed, [prop]: false },
                tracks: { ...next.tracks, [prop]: [] },
              },
              prop,
              value,
            );
          } else {
            next = { ...next, tracks: { ...next.tracks, [prop]: track } };
          }
        }
        return next;
      }),
    });
  },
  easyEase: () => {
    const sel = get().selectedKey;
    if (!sel) return;
    set({
      layers: mapLayer(get().layers, sel.layerId, (layer) => {
        const track = [...layer.tracks[sel.prop]].sort((a, b) => a.t - b.t);
        const index = track.findIndex((k) => k.id === sel.id);
        if (index < 0) return layer;
        const ids = new Set([track[index].id, index > 0 ? track[index - 1].id : ""]);
        return {
          ...layer,
          tracks: {
            ...layer.tracks,
            [sel.prop]: track.map((k) => (ids.has(k.id) ? { ...k, interp: "ease" } : k)),
          },
        };
      }),
    });
  },
  resetDemo: () => {
    const layers = demoLayers();
    set({
      layers,
      duration: DEMO_DURATION,
      fps: DEFAULT_FPS,
      loop: true,
      projectWidth: DEMO_WIDTH,
      projectHeight: DEMO_HEIGHT,
      exportWidth: DEMO_WIDTH,
      exportHeight: DEMO_HEIGHT,
      safeArea: false,
      snapEnabled: true,
      motionBlur: false,
      motionBlurStrength: 6,
      time: 0,
      playing: true,
      selectedId: null,
      selectedKey: null,
      selectedKeys: [],
      expanded: Object.fromEntries(layers.map((l) => [l.id, false])),
      seq: layers.length,
      autoKey: false,
    });
  },
  clearAll: () =>
    set({
      layers: [],
      selectedId: null,
      selectedKey: null,
      selectedKeys: [],
      time: 0,
      playing: false,
    }),
  replace: (doc) => {
    const layers = doc.layers?.length ? doc.layers.map(hydrateLayer) : demoLayers();
    const projectWidth = safeDimension(doc.projectWidth ?? 800, 800);
    const projectHeight = safeDimension(doc.projectHeight ?? 500, 500);
    set({
      duration: doc.duration || 3,
      fps: normalizeFrameRate(doc.fps),
      loop: doc.loop ?? true,
      pxPerSec: doc.pxPerSec || 120,
      projectWidth,
      projectHeight,
      exportWidth: safeDimension(doc.exportWidth ?? projectWidth, projectWidth),
      exportHeight: safeDimension(doc.exportHeight ?? projectHeight, projectHeight),
      safeArea: doc.safeArea ?? false,
      snapEnabled: doc.snapEnabled ?? true,
      motionBlur: doc.motionBlur ?? false,
      motionBlurStrength: safeBlurStrength(doc.motionBlurStrength ?? 6),
      layers,
      time: 0,
      playing: false,
      selectedId: layers[0]?.id ?? null,
      selectedKey: null,
      selectedKeys: [],
      expanded: Object.fromEntries(layers.map((l) => [l.id, true])),
      seq: layers.length,
    });
  },
  snapshot: () => {
    const {
      duration,
      fps,
      loop,
      pxPerSec,
      projectWidth,
      projectHeight,
      exportWidth,
      exportHeight,
      safeArea,
      snapEnabled,
      motionBlur,
      motionBlurStrength,
      layers,
    } = get();
    return {
      duration,
      fps,
      loop,
      pxPerSec,
      projectWidth,
      projectHeight,
      exportWidth,
      exportHeight,
      safeArea,
      snapEnabled,
      motionBlur,
      motionBlurStrength,
      layers,
    };
  },
}));

useDoc.subscribe((state, previous) => {
  if (applyingHistory || !hasDocumentChange(state, previous)) return;
  if (undoGroupDepth > 0) {
    if (!undoGroupRecorded) {
      pushUndoFrame(historyFrame(previous));
      undoGroupRecorded = true;
    }
  } else {
    pushUndoFrame(historyFrame(previous));
  }
  undoFuture.length = 0;
  useDoc.setState({ undoCount: undoPast.length, redoCount: 0 });
});

export function loadSnapshot(): PersistedDoc | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as PersistedDoc;
    if (!doc || !Array.isArray(doc.layers)) return null;
    return doc;
  } catch {
    return null;
  }
}

export function saveSnapshot(doc: PersistedDoc) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
}

export function layerById(id: string | null): Layer | undefined {
  if (!id) return undefined;
  return useDoc.getState().layers.find((l) => l.id === id);
}
