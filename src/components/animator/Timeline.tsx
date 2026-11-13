import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Flag,
  Folder,
  FolderMinus,
  FolderPlus,
  GripVertical,
  CircleDot,
  Link2,
  LockKeyhole,
  LockKeyholeOpen,
  Magnet,
  Maximize2,
  Pause,
  Play,
  Repeat,
  ScanLine,
  Scissors,
  Square,
  Spline,
  StepBack,
  StepForward,
  Trash2,
  Timer,
  Waves,
} from "lucide-react";
import {
  DEFAULT_BEZIER,
  PROP_LABEL,
  PROPS,
  STYLE_PROPS,
  colorToNumber,
  displayed,
  fmtRulerTime,
  fmtTime,
  keyNear,
  layerClipRange,
  layerIsLocked,
  numberToColor,
  snapTime,
  type Keyframe,
  type Layer,
  type Interp,
  type PropKey,
  type PathKeyframe,
} from "@/lib/animator/model";
import {
  type CopiedKeyframe,
  type KeyframeMove,
  type SelectedKey,
  useDoc,
} from "@/lib/animator/store";
import { KeyNav } from "./KeyNav";
import { TimelineClip } from "./TimelineClip";
import { ValueGraphEditor } from "./ValueGraphEditor";

const LABEL_W = 280;
const FIT_MODE_KEY = "kairo-timeline-zoom-mode";
const TIME_DISPLAY_KEY = "kairo-timeline-time-display";
const HEIGHT_KEY = "kairo-timeline-height";
const MIN_TIMELINE_HEIGHT = 160;
type TimeDisplayMode = "timecode" | "frames";
type TimelineProp = PropKey | "position" | "scaleVector";
const TIMELINE_TRANSFORM_PROPS: TimelineProp[] = ["opacity", "position", "rotate", "scaleVector"];
const INTERPOLATION_MENU: { value: Interp; label: string }[] = [
  { value: "linear", label: "线性" },
  { value: "ease", label: "缓入缓出" },
  { value: "bezier", label: "贝塞尔曲线" },
  { value: "hold", label: "定格" },
];

function combinedInterpolation(primary?: Keyframe, secondary?: Keyframe): Interp {
  const values = [primary?.interp, secondary?.interp];
  if (values.includes("bezier")) return "bezier";
  if (values.includes("ease")) return "ease";
  if (values.includes("hold")) return "hold";
  return "linear";
}

function clampTimelineHeight(value: number): number {
  const maxHeight = Math.max(
    MIN_TIMELINE_HEIGHT,
    window.innerHeight * (window.innerWidth < 1024 ? 0.48 : 0.72),
  );
  return Math.round(Math.min(maxHeight, Math.max(MIN_TIMELINE_HEIGHT, value)));
}

type MarqueeState = {
  left: number;
  top: number;
  width: number;
  height: number;
  startClientX: number;
  startClientY: number;
  additive: boolean;
};

type KeyframeMenuState = { x: number; y: number };
type TimelineKeyDrag = {
  pointerId: number;
  startTime: number;
  pointerOffsetX: number;
  keys: KeyframeMove[];
};

type TimelineLayerRow = { layer: Layer; depth: number };

function buildTimelineLayerRows(
  layers: Layer[],
  expanded: Record<string, boolean>,
): TimelineLayerRow[] {
  const ordered = [...layers].reverse();
  const groups = new Set(layers.filter((layer) => layer.kind === "group").map((layer) => layer.id));
  const rows: TimelineLayerRow[] = [];
  const visit = (layer: Layer, depth: number, path: Set<string>) => {
    if (path.has(layer.id)) return;
    rows.push({ layer, depth });
    if (layer.kind !== "group" || expanded[layer.id] === false) return;
    const nextPath = new Set(path).add(layer.id);
    for (const child of ordered.filter((item) => item.groupId === layer.id))
      visit(child, depth + 1, nextPath);
  };
  for (const layer of ordered) {
    if (!layer.groupId || !groups.has(layer.groupId)) visit(layer, 0, new Set());
  }
  return rows;
}

function frameToX(frame: number, pxPerSecond: number, fps: number): number {
  return (frame * pxPerSecond) / fps;
}

function timeToX(time: number, pxPerSecond: number, fps: number): number {
  return frameToX(Math.round(time * fps), pxPerSecond, fps);
}

function xToTime(x: number, pxPerSecond: number, duration: number, fps: number): number {
  return snapTime(x / pxPerSecond, duration, fps);
}

function formatTimelineTime(time: number, fps: number, mode: TimeDisplayMode): string {
  if (mode === "frames") return `${Math.max(0, Math.round(time * fps))} 帧`;
  return fmtTime(time, fps);
}

function formatRulerTime(frame: number, fps: number, mode: TimeDisplayMode): string {
  if (mode === "frames") return String(frame);
  return fmtRulerTime(frame / fps, fps);
}

function TimelineMarkerChip({
  marker,
  left,
  fps,
  onMove,
  onSeek,
  onRename,
  onRemove,
  timeFromClient,
  format,
}: {
  marker: { id: string; t: number; name: string };
  left: number;
  fps: number;
  onMove: (time: number) => void;
  onSeek: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  timeFromClient: (clientX: number) => number;
  format: (time: number) => string;
}) {
  return (
    <button
      type="button"
      data-marker={marker.id}
      aria-label={`${marker.name} · ${format(marker.t)}`}
      title={`${marker.name} · ${format(marker.t)} · 拖动移动，双击重命名，右键删除`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        onSeek();
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          onMove(timeFromClient(event.clientX));
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const name = window.prompt("标记名称", marker.name);
        if (name !== null) onRename(name);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (window.confirm(`删除标记“${marker.name}”？`)) onRemove();
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        onMove(marker.t + (event.key === "ArrowLeft" ? -1 : 1) / fps);
      }}
      className="absolute inset-y-0 z-10 grid w-5 -translate-x-1/2 place-items-center text-key hover:text-fg focus-visible:outline-1 focus-visible:outline-primary"
      style={{ left }}
    >
      <Flag className="size-3 fill-current" />
    </button>
  );
}

export function Timeline() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrub = useRef(false);
  const marqueeStart = useRef<MarqueeState | null>(null);
  const resizeStart = useRef<{ y: number; height: number } | null>(null);
  const clipboard = useRef<CopiedKeyframe[]>([]);
  const keyDrag = useRef<TimelineKeyDrag | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [keyMenu, setKeyMenu] = useState<KeyframeMenuState | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [fitWidth, setFitWidth] = useState(true);
  const [timelineHeight, setTimelineHeight] = useState<number | null>(null);
  const [timeDisplayMode, setTimeDisplayMode] = useState<TimeDisplayMode>("timecode");
  const [graphMode, setGraphMode] = useState(false);
  const [timeDisplayReady, setTimeDisplayReady] = useState(false);

  useEffect(() => {
    let savedHeight = Number.NaN;
    try {
      savedHeight = Number(window.localStorage.getItem(HEIGHT_KEY));
    } catch {
      // The default height still works when storage is unavailable.
    }
    setTimelineHeight(
      clampTimelineHeight(
        Number.isFinite(savedHeight) && savedHeight > 0 ? savedHeight : window.innerHeight * 0.42,
      ),
    );
    const onResize = () =>
      setTimelineHeight((height) => (height === null ? height : clampTimelineHeight(height)));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(FIT_MODE_KEY) === "manual") setFitWidth(false);
    } catch {
      // The default fit mode still works when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TIME_DISPLAY_KEY);
      if (stored === "frames" || stored === "timecode") setTimeDisplayMode(stored);
    } catch {
      // Timecode remains the default when storage is unavailable.
    }
    setTimeDisplayReady(true);
  }, []);

  useEffect(() => {
    if (!timeDisplayReady) return;
    try {
      window.localStorage.setItem(TIME_DISPLAY_KEY, timeDisplayMode);
    } catch {
      // The display mode still works for the current session.
    }
  }, [timeDisplayMode, timeDisplayReady]);
  const layers = useDoc((s) => s.layers);
  const expanded = useDoc((s) => s.expanded);
  const duration = useDoc((s) => s.duration);
  const fps = useDoc((s) => s.fps);
  const time = useDoc((s) => s.time);
  const px = useDoc((s) => s.pxPerSec);
  const selectedId = useDoc((s) => s.selectedId);
  const selectedLayerIds = useDoc((s) => s.selectedLayerIds);
  const selectedKeys = useDoc((s) => s.selectedKeys);
  const addPathKey = useDoc((s) => s.addPathKey);
  const playing = useDoc((s) => s.playing);
  const loop = useDoc((s) => s.loop);
  const autoKey = useDoc((s) => s.autoKey);
  const snapEnabled = useDoc((s) => s.snapEnabled);
  const safeArea = useDoc((s) => s.safeArea);
  const motionBlur = useDoc((s) => s.motionBlur);
  const motionBlurStrength = useDoc((s) => s.motionBlurStrength);
  const markers = useDoc((s) => s.markers);
  const workArea = useDoc((s) => s.workArea);
  const setTime = useDoc((s) => s.setTime);
  const togglePlay = useDoc((s) => s.togglePlay);
  const stepFrame = (direction: -1 | 1) => {
    const state = useDoc.getState();
    if (state.playing) state.togglePlay();
    state.setTime(snapTime(state.time + direction / state.fps, state.duration, state.fps));
  };
  const toggleLoop = useDoc((s) => s.toggleLoop);
  const stop = useDoc((s) => s.stop);
  const setDuration = useDoc((s) => s.setDuration);
  const setPx = useDoc((s) => s.setPx);
  const toggleAutoKey = useDoc((s) => s.toggleAutoKey);
  const toggleSnap = useDoc((s) => s.toggleSnap);
  const toggleSafeArea = useDoc((s) => s.toggleSafeArea);
  const toggleMotionBlur = useDoc((s) => s.toggleMotionBlur);
  const splitLayerAtTime = useDoc((s) => s.splitLayerAtTime);
  const rippleDeleteLayer = useDoc((s) => s.rippleDeleteLayer);
  const addMarker = useDoc((s) => s.addMarker);
  const moveMarker = useDoc((s) => s.moveMarker);
  const removeMarker = useDoc((s) => s.removeMarker);
  const renameMarker = useDoc((s) => s.renameMarker);
  const setWorkAreaEdge = useDoc((s) => s.setWorkAreaEdge);
  const clearWorkArea = useDoc((s) => s.clearWorkArea);
  const toggleLayerLocked = useDoc((s) => s.toggleLayerLocked);
  const toggleLayerSolo = useDoc((s) => s.toggleLayerSolo);
  const setMotionBlurStrength = useDoc((s) => s.setMotionBlurStrength);
  const punchKeys = useDoc((s) => s.punchKeys);
  const selectLayer = useDoc((s) => s.selectLayer);
  const toggleExpanded = useDoc((s) => s.toggleExpanded);
  const toggleVisible = useDoc((s) => s.toggleVisible);
  const selectKeys = useDoc((s) => s.selectKeys);
  const setSelectedInterpolation = useDoc((s) => s.setSelectedInterpolation);
  const deleteSelectedKey = useDoc((s) => s.deleteSelectedKey);
  const moveLayer = useDoc((s) => s.moveLayer);
  const createGroup = useDoc((s) => s.createGroup);
  const ungroupLayer = useDoc((s) => s.ungroupLayer);
  const selectedLayerIndex = selectedId ? layers.findIndex((layer) => layer.id === selectedId) : -1;
  const selectedLayer = selectedId ? layers.find((layer) => layer.id === selectedId) : undefined;
  const selectedLayers = selectedLayerIds
    .map((id) => layers.find((layer) => layer.id === id))
    .filter((layer): layer is Layer => Boolean(layer));
  const canGroupSelection =
    selectedLayers.length >= 2 &&
    selectedLayers.every((layer) => layer.groupId === selectedLayers[0].groupId);
  const timelineLayerRows = useMemo(
    () => buildTimelineLayerRows(layers, expanded),
    [layers, expanded],
  );
  const selectedClip = selectedLayer ? layerClipRange(selectedLayer, duration, fps) : undefined;
  const canSplit = Boolean(
    selectedLayer &&
    !layerIsLocked(selectedLayer, layers) &&
    selectedLayer.kind !== "group" &&
    selectedClip &&
    time > selectedClip.inPoint + 0.5 / fps &&
    time < selectedClip.outPoint - 0.5 / fps,
  );

  const copySelectedKeys = useCallback(() => {
    const state = useDoc.getState();
    const selected = state.selectedKeys.length
      ? state.selectedKeys
      : state.selectedKey
        ? [state.selectedKey]
        : [];
    const found = selected.flatMap((selection) => {
      const layer = state.layers.find((item) => item.id === selection.layerId);
      const key = layer?.tracks[selection.prop].find((item) => item.id === selection.id);
      return key ? [{ selection, key }] : [];
    });
    if (found.length === 0) return 0;
    const start = Math.min(...found.map(({ key }) => key.t));
    clipboard.current = found.map(({ selection, key }) => ({
      layerId: selection.layerId,
      prop: selection.prop,
      offset: key.t - start,
      v: key.v,
      interp: key.interp,
      bezier: { ...(key.bezier ?? DEFAULT_BEZIER) },
      ...(key.motionIn ? { motionIn: { ...key.motionIn } } : {}),
      ...(key.motionOut ? { motionOut: { ...key.motionOut } } : {}),
    }));
    return found.length;
  }, []);

  const pasteCopiedKeys = useCallback(() => {
    const state = useDoc.getState();
    state.pasteKeyframes(clipboard.current, state.time);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable)
        return;
      if (event.key === "Escape") {
        setKeyMenu(null);
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === "c" && copySelectedKeys() > 0) {
        event.preventDefault();
      } else if (event.key.toLowerCase() === "v" && clipboard.current.length > 0) {
        event.preventDefault();
        pasteCopiedKeys();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copySelectedKeys, pasteCopiedKeys]);

  const labelWidth = viewportWidth > 0 && viewportWidth < 640 ? 226 : LABEL_W;
  const fittedPx = Math.min(
    480,
    Math.max(40, (viewportWidth - labelWidth - 64) / Math.max(duration, 0.5)),
  );
  const timelinePx = fitWidth && viewportWidth > labelWidth ? fittedPx : px;
  const width = Math.max(duration * timelinePx + 64, viewportWidth - labelWidth, 320);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      setViewportWidth(Math.round(entry.contentRect.width));
    });
    resizeObserver.observe(element);
    setViewportWidth(element.clientWidth);
    return () => resizeObserver.disconnect();
  }, []);

  function setZoomMode(mode: "fit" | "manual") {
    setFitWidth(mode === "fit");
    try {
      window.localStorage.setItem(FIT_MODE_KEY, mode);
    } catch {
      // The zoom control remains usable when storage is unavailable.
    }
  }

  function applyTimelineHeight(height: number) {
    const next = clampTimelineHeight(height);
    setTimelineHeight(next);
    try {
      window.localStorage.setItem(HEIGHT_KEY, String(next));
    } catch {
      // Resizing remains usable when storage is unavailable.
    }
  }

  function timeFromClient(clientX: number) {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft - labelWidth;
    return xToTime(x, timelinePx, duration, fps);
  }

  function beginKeyMove(
    event: ReactPointerEvent<HTMLButtonElement>,
    startTime: number,
    clickedKeys: SelectedKey[],
  ) {
    event.stopPropagation();
    if (event.button !== 0 || clickedKeys.length === 0 || !scrollRef.current) return;
    event.preventDefault();
    const state = useDoc.getState();
    if (clickedKeys.some((key) => state.layers.find((layer) => layer.id === key.layerId)?.locked))
      return;
    const alreadySelected = clickedKeys.every((key) =>
      state.selectedKeys.some(
        (item) => item.layerId === key.layerId && item.prop === key.prop && item.id === key.id,
      ),
    );
    if (event.shiftKey) {
      state.selectKeys([
        ...new Map(
          [...state.selectedKeys, ...clickedKeys].map((key) => [
            `${key.layerId}:${key.prop}:${key.id}`,
            key,
          ]),
        ).values(),
      ]);
    } else if (!alreadySelected) {
      state.selectKeys(clickedKeys);
    }

    const selected = useDoc.getState().selectedKeys;
    const selection = selected.length > 0 ? selected : clickedKeys;
    const keys = selection.flatMap((key) => {
      const layer = state.layers.find((item) => item.id === key.layerId);
      const origin = layer?.tracks[key.prop].find((item) => item.id === key.id);
      return origin ? [{ ...key, t: origin.t }] : [];
    });
    if (keys.length === 0) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const pointerX = event.clientX - rect.left + scrollRef.current.scrollLeft - labelWidth;
    const pointerOffsetX = pointerX - timeToX(startTime, timelinePx, fps);
    keyDrag.current = { pointerId: event.pointerId, startTime, pointerOffsetX, keys };
    useDoc.getState().beginUndoGroup();
    scrollRef.current.setPointerCapture(event.pointerId);
  }

  return (
    <section
      className="flex min-h-0 shrink-0 flex-col overflow-hidden border-t border-border bg-surface"
      style={{ height: timelineHeight === null ? "42vh" : `${timelineHeight}px` }}
    >
      <div
        role="separator"
        aria-label="调整时间线高度"
        aria-orientation="horizontal"
        aria-valuemin={MIN_TIMELINE_HEIGHT}
        aria-valuenow={timelineHeight ?? 300}
        aria-keyshortcuts="ArrowUp ArrowDown Home"
        tabIndex={0}
        title="上下拖动调整时间线高度 · 双击恢复默认 · ↑ / ↓ 微调"
        className="timeline-resize-handle"
        onPointerDown={(event) => {
          event.preventDefault();
          resizeStart.current = {
            y: event.clientY,
            height: timelineHeight ?? window.innerHeight * 0.42,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const origin = resizeStart.current;
          if (origin) {
            setTimelineHeight(clampTimelineHeight(origin.height + origin.y - event.clientY));
          }
        }}
        onPointerUp={(event) => {
          const origin = resizeStart.current;
          if (origin) applyTimelineHeight(origin.height + origin.y - event.clientY);
          resizeStart.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          resizeStart.current = null;
        }}
        onDoubleClick={() => applyTimelineHeight(window.innerHeight * 0.42)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            applyTimelineHeight((timelineHeight ?? 300) + (event.key === "ArrowUp" ? 24 : -24));
          } else if (event.key === "Home") {
            event.preventDefault();
            event.stopPropagation();
            applyTimelineHeight(window.innerHeight * 0.42);
          }
        }}
      />
      <div className="relative flex flex-wrap items-center gap-2 border-b border-border px-2 py-1.5">
        <span
          aria-label={`当前时间 ${formatTimelineTime(time, fps, timeDisplayMode)}，总时长 ${formatTimelineTime(duration, fps, timeDisplayMode)}，${fps}fps`}
          className="font-mono text-xs text-muted tabular-nums"
        >
          {formatTimelineTime(time, fps, timeDisplayMode)} /{" "}
          {formatTimelineTime(duration, fps, timeDisplayMode)} · {fps}fps
        </span>
        <div
          role="group"
          aria-label="剪辑与标记"
          className="flex shrink-0 items-center gap-1 border-l border-border pl-2"
        >
          <button
            type="button"
            disabled={!canSplit}
            onClick={() => selectedId && splitLayerAtTime(selectedId, time)}
            title="在播放头分割选中片段"
            className="flex h-7 items-center gap-1 rounded border border-border px-1.5 text-[10px] text-muted hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Scissors className="size-3" />
            分割
          </button>
          <button
            type="button"
            disabled={
              !selectedLayer ||
              selectedLayer.kind === "group" ||
              layerIsLocked(selectedLayer, layers)
            }
            onClick={() => selectedId && rippleDeleteLayer(selectedId)}
            title="删除选中片段，并将后续片段前移"
            className="flex h-7 items-center gap-1 rounded border border-border px-1.5 text-[10px] text-muted hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Trash2 className="size-3" />
            波纹删除
          </button>
          <button
            type="button"
            onClick={() => addMarker(time)}
            title="在播放头添加标记"
            className="flex h-7 items-center gap-1 rounded border border-border px-1.5 text-[10px] text-muted hover:bg-surface-2 hover:text-fg"
          >
            <Flag className="size-3" />
            标记
          </button>
          <span className="ml-1 hidden font-mono text-[9px] text-muted xl:inline">
            {workArea
              ? `${formatTimelineTime(workArea.start, fps, timeDisplayMode)}–${formatTimelineTime(workArea.end, fps, timeDisplayMode)}`
              : "全时长"}
          </span>
          <button
            type="button"
            aria-label="将播放头设为工作区入点"
            title="将播放头设为工作区入点"
            onClick={() => setWorkAreaEdge("start", time)}
            className={`grid size-7 place-items-center rounded border text-[10px] font-semibold transition-colors ${workArea ? "border-primary/65 bg-primary/12 text-primary shadow-[inset_0_0_0_1px_rgb(76_159_255/0.12)]" : "border-primary/35 text-primary/80 hover:border-primary/60 hover:bg-primary/10 hover:text-primary"}`}
          >
            入
          </button>
          <button
            type="button"
            aria-label="将播放头设为工作区出点"
            title="将播放头设为工作区出点"
            onClick={() => setWorkAreaEdge("end", time)}
            className={`grid size-7 place-items-center rounded border text-[10px] font-semibold transition-colors ${workArea ? "border-key/70 bg-key/12 text-key shadow-[inset_0_0_0_1px_rgb(230_179_37/0.12)]" : "border-key/35 text-key/85 hover:border-key/65 hover:bg-key/10 hover:text-key"}`}
          >
            出
          </button>
          {workArea && (
            <button
              type="button"
              onClick={clearWorkArea}
              title="清除工作区，恢复全时长预览"
              className="grid size-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-fg"
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
        <button
          type="button"
          disabled={!selectedId || selectedLayer?.kind === "group"}
          onClick={() => selectedId && punchKeys(selectedId)}
          className="rounded-md bg-key px-2.5 py-1 text-xs font-medium text-bg disabled:opacity-40"
          title={
            selectedLayer?.kind === "group"
              ? "编组是组织容器，不添加关键帧"
              : "给已开秒表的属性在播放头打 K；若都没开，则五个属性一起打"
          }
        >
          打 K 帧
        </button>
        <button
          type="button"
          aria-pressed={graphMode}
          onClick={() => setGraphMode((value) => !value)}
          title="切换时间线与数值曲线编辑器"
          className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] ${graphMode ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted hover:bg-surface-2 hover:text-fg"}`}
        >
          <Spline className="size-3.5" />
          曲线
        </button>
        <button
          type="button"
          aria-pressed={autoKey}
          onClick={toggleAutoKey}
          className={`rounded-md border px-2 py-1 text-xs ${autoKey ? "border-play text-play" : "border-border text-muted"}`}
          title="自动关键帧：改任何属性都会打 K"
        >
          自动 K
        </button>
        <div className="flex max-w-full flex-wrap items-center gap-1.5 border-l border-border pl-2">
          <button
            type="button"
            aria-label="磁吸吸附"
            aria-pressed={snapEnabled}
            onClick={toggleSnap}
            title="磁吸吸附 · 对齐画布与其他图层"
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors ${snapEnabled ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted hover:bg-surface-2 hover:text-fg"}`}
          >
            <Magnet className="size-3.5" />
            磁吸
          </button>
          <button
            type="button"
            aria-label="显示安全框"
            aria-pressed={safeArea}
            onClick={toggleSafeArea}
            title="安全框 · 动作安全区 90%，标题安全区 80%"
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors ${safeArea ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted hover:bg-surface-2 hover:text-fg"}`}
          >
            <ScanLine className="size-3.5" />
            安全框
          </button>
          <button
            type="button"
            aria-label="运动模糊"
            aria-pressed={motionBlur}
            onClick={toggleMotionBlur}
            title="运动模糊 · 应用于预览和导出"
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors ${motionBlur ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted hover:bg-surface-2 hover:text-fg"}`}
          >
            <Waves className="size-3.5" />
            运动模糊
          </button>
          <label
            className="flex shrink-0 items-center gap-1 text-[10px] text-muted"
            title="运动模糊强度"
          >
            强度
            <input
              type="range"
              min={0}
              max={12}
              step={1}
              value={motionBlurStrength}
              onChange={(event) => setMotionBlurStrength(Number(event.target.value))}
              disabled={!motionBlur}
              aria-label="运动模糊强度"
              className="timeline-range w-16 disabled:opacity-40"
            />
            <span className="w-3 text-right font-mono text-fg">{motionBlurStrength}</span>
          </label>
        </div>
        <div
          role="group"
          aria-label="播放控制"
          className="mx-auto flex h-9 shrink-0 items-center gap-0.5"
        >
          <button
            type="button"
            onClick={() => stepFrame(-1)}
            className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface hover:text-fg focus-visible:outline-2 focus-visible:outline-primary"
            aria-label="上一帧"
            title="上一帧 · ←"
          >
            <StepBack className="size-4" />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            className="grid size-9 place-items-center rounded-full bg-primary text-bg transition-colors hover:brightness-110 focus-visible:outline-2 focus-visible:outline-primary"
            aria-label={playing ? "暂停" : "播放"}
            title={playing ? "暂停 · 空格" : "播放 · 空格"}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <button
            type="button"
            onClick={() => stepFrame(1)}
            className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface hover:text-fg focus-visible:outline-2 focus-visible:outline-primary"
            aria-label="下一帧"
            title="下一帧 · →"
          >
            <StepForward className="size-4" />
          </button>
          <button
            type="button"
            onClick={stop}
            className="grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-surface hover:text-fg focus-visible:outline-2 focus-visible:outline-primary"
            aria-label="停止并回到开始"
            title="停止并回到开始"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-muted">
            时长
            <input
              type="number"
              min={0.5}
              max={30}
              step={0.5}
              value={duration}
              onChange={(e) => {
                if (e.target.value !== "") setDuration(Number(e.target.value));
              }}
              className="w-14 rounded-md border border-border bg-surface-2 px-1 py-0.5 font-mono text-fg"
            />
            s
          </label>
          <button
            type="button"
            aria-label={loop ? "关闭动画循环" : "开启动画循环"}
            aria-pressed={loop}
            title={loop ? "循环播放已开启，点击改为播放一次" : "播放一次，点击开启循环播放"}
            onClick={toggleLoop}
            className={`flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-xs transition-colors ${loop ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted hover:bg-surface-2 hover:text-fg"}`}
          >
            <Repeat className="size-3.5" />
            循环
          </button>
          <label className="flex items-center gap-1 text-xs text-muted">
            缩放
            <input
              type="range"
              min={40}
              max={480}
              value={timelinePx}
              aria-label="时间线缩放"
              onChange={(event) => {
                setZoomMode("manual");
                setPx(Number(event.target.value));
              }}
              className="timeline-range w-24"
            />
          </label>
          <button
            type="button"
            onClick={() => setZoomMode("fit")}
            title="适配时间线宽度"
            aria-label="适配时间线宽度"
            aria-pressed={fitWidth}
            className={`grid size-8 place-items-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-primary ${fitWidth ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted hover:text-fg"}`}
          >
            <Maximize2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="app-scrollbar timeline-scroll relative min-h-0 flex-1 overflow-auto"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (
            target.closest("[data-key]") ||
            target.closest("[data-label]") ||
            target.closest("[data-marker]")
          )
            return;
          if (target.closest("[data-track-area]")) {
            if (event.button !== 0 || !scrollRef.current) return;
            event.preventDefault();
            const rect = scrollRef.current.getBoundingClientRect();
            const left = event.clientX - rect.left + scrollRef.current.scrollLeft;
            const top = event.clientY - rect.top + scrollRef.current.scrollTop;
            const start = {
              left,
              top,
              width: 0,
              height: 0,
              startClientX: event.clientX,
              startClientY: event.clientY,
              additive: event.shiftKey,
            };
            marqueeStart.current = start;
            setMarquee(start);
            scrollRef.current.setPointerCapture(event.pointerId);
            return;
          }
          if (event.button !== 0) return;
          event.preventDefault();
          scrub.current = true;
          setTime(timeFromClient(event.clientX));
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = keyDrag.current;
          if (
            drag &&
            drag.pointerId === event.pointerId &&
            scrollRef.current?.hasPointerCapture(event.pointerId)
          ) {
            const rect = scrollRef.current.getBoundingClientRect();
            const x =
              event.clientX -
              rect.left +
              scrollRef.current.scrollLeft -
              labelWidth -
              drag.pointerOffsetX;
            const targetState = useDoc.getState();
            const targetTime = xToTime(x, timelinePx, targetState.duration, targetState.fps);
            useDoc.getState().moveKeys(drag.keys, targetTime - drag.startTime);
            return;
          }
          const start = marqueeStart.current;
          if (start && scrollRef.current) {
            const rect = scrollRef.current.getBoundingClientRect();
            const x = event.clientX - rect.left + scrollRef.current.scrollLeft;
            const y = event.clientY - rect.top + scrollRef.current.scrollTop;
            setMarquee({
              ...start,
              left: Math.min(start.left, x),
              top: Math.min(start.top, y),
              width: Math.abs(x - (start.startClientX - rect.left + scrollRef.current.scrollLeft)),
              height: Math.abs(y - (start.startClientY - rect.top + scrollRef.current.scrollTop)),
            });
            return;
          }
          if (!scrub.current) return;
          setTime(timeFromClient(event.clientX));
        }}
        onPointerUp={(event) => {
          if (keyDrag.current?.pointerId === event.pointerId) {
            keyDrag.current = null;
            useDoc.getState().endUndoGroup();
            if (scrollRef.current?.hasPointerCapture(event.pointerId)) {
              scrollRef.current.releasePointerCapture(event.pointerId);
            }
            return;
          }
          const start = marqueeStart.current;
          if (start && scrollRef.current) {
            const dx = event.clientX - start.startClientX;
            const dy = event.clientY - start.startClientY;
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) {
              setTime(timeFromClient(event.clientX));
              if (!start.additive) selectKeys([]);
            } else {
              const box = {
                left: Math.min(start.startClientX, event.clientX),
                right: Math.max(start.startClientX, event.clientX),
                top: Math.min(start.startClientY, event.clientY),
                bottom: Math.max(start.startClientY, event.clientY),
              };
              const found = [...scrollRef.current.querySelectorAll<HTMLButtonElement>("[data-key]")]
                .filter((key) => {
                  const rect = key.getBoundingClientRect();
                  return (
                    rect.right >= box.left &&
                    rect.left <= box.right &&
                    rect.bottom >= box.top &&
                    rect.top <= box.bottom
                  );
                })
                .flatMap((key): SelectedKey[] => {
                  const layerId = key.dataset.layerId ?? "";
                  if (key.dataset.keyPair === "true") {
                    return [
                      ...(key.dataset.pairPrimaryId
                        ? [
                            {
                              layerId,
                              prop: key.dataset.prop as PropKey,
                              id: key.dataset.pairPrimaryId,
                            },
                          ]
                        : []),
                      ...(key.dataset.pairSecondaryId
                        ? [
                            {
                              layerId,
                              prop: key.dataset.pairSecondaryProp as PropKey,
                              id: key.dataset.pairSecondaryId,
                            },
                          ]
                        : []),
                    ];
                  }
                  const id = key.dataset.keyId ?? "";
                  return layerId && id ? [{ layerId, prop: key.dataset.prop as PropKey, id }] : [];
                });
              const combined = start.additive
                ? [
                    ...new Map(
                      [...selectedKeys, ...found].map((key) => [
                        `${key.layerId}:${key.prop}:${key.id}`,
                        key,
                      ]),
                    ).values(),
                  ]
                : found;
              selectKeys(combined);
            }
            marqueeStart.current = null;
            setMarquee(null);
          }
          scrub.current = false;
        }}
        onPointerCancel={(event) => {
          if (keyDrag.current?.pointerId === event.pointerId) {
            keyDrag.current = null;
            useDoc.getState().endUndoGroup();
          }
          marqueeStart.current = null;
          setMarquee(null);
          scrub.current = false;
        }}
      >
        <div className="relative" style={{ width: labelWidth + width }}>
          <div className="sticky top-0 z-20 flex h-7 border-b border-border bg-surface-2">
            <div
              data-label
              className="sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r border-border bg-surface-2 px-2 text-xs text-muted"
              style={{ width: labelWidth }}
            >
              <span className="mr-1 whitespace-nowrap">
                <span className="hidden min-[640px]:inline">图层 / 变换</span>
                <span className="min-[640px]:hidden">图层</span>
              </span>
              <div
                role="group"
                aria-label="时间显示方式"
                className="flex shrink-0 items-center rounded-md border border-border bg-bg/55 p-0.5"
              >
                <button
                  type="button"
                  aria-pressed={timeDisplayMode === "timecode"}
                  title="以时间码显示播放头和标尺"
                  onClick={() => setTimeDisplayMode("timecode")}
                  className={`h-5 rounded px-1 text-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-primary ${timeDisplayMode === "timecode" ? "bg-primary/15 text-primary" : "text-muted hover:text-fg"}`}
                >
                  时间码
                </button>
                <button
                  type="button"
                  aria-pressed={timeDisplayMode === "frames"}
                  title="以帧数显示播放头和标尺"
                  onClick={() => setTimeDisplayMode("frames")}
                  className={`h-5 rounded px-1 text-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-primary ${timeDisplayMode === "frames" ? "bg-primary/15 text-primary" : "text-muted hover:text-fg"}`}
                >
                  帧
                </button>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 border-l border-border pl-1">
                <button
                  type="button"
                  aria-label="置于最前"
                  title="置于最前"
                  disabled={!selectedId || selectedLayerIndex === layers.length - 1}
                  onClick={() => selectedId && moveLayer(selectedId, "front")}
                  className="grid size-6 place-items-center rounded text-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowUpToLine className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="上移一层"
                  title="上移一层"
                  disabled={!selectedId || selectedLayerIndex === layers.length - 1}
                  onClick={() => selectedId && moveLayer(selectedId, "forward")}
                  className="grid size-6 place-items-center rounded text-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="下移一层"
                  title="下移一层"
                  disabled={!selectedId || selectedLayerIndex === 0}
                  onClick={() => selectedId && moveLayer(selectedId, "backward")}
                  className="grid size-6 place-items-center rounded text-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="置于最后"
                  title="置于最后"
                  disabled={!selectedId || selectedLayerIndex === 0}
                  onClick={() => selectedId && moveLayer(selectedId, "back")}
                  className="grid size-6 place-items-center rounded text-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowDownToLine className="size-3.5" />
                </button>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 border-l border-border pl-1">
                {selectedLayer?.kind === "group" ? (
                  <button
                    type="button"
                    aria-label="取消编组"
                    title="取消编组"
                    onClick={() => ungroupLayer(selectedLayer.id)}
                    className="grid size-6 place-items-center rounded text-muted hover:bg-surface hover:text-fg"
                  >
                    <FolderMinus className="size-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="将所选图层编组"
                    title={
                      canGroupSelection ? "将所选图层编组" : "按住 Ctrl / Shift 选择同级图层后编组"
                    }
                    disabled={!canGroupSelection}
                    onClick={() => createGroup(selectedLayerIds)}
                    className="grid size-6 place-items-center rounded text-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <FolderPlus className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
            <Ruler
              duration={duration}
              fps={fps}
              px={timelinePx}
              width={width}
              timeDisplayMode={timeDisplayMode}
            />
          </div>

          {workArea && (
            <div
              aria-hidden="true"
              className="timeline-work-area pointer-events-none absolute bottom-0 top-7 z-0 border-y border-primary/25 bg-primary/[0.045]"
              style={{
                left: labelWidth + timeToX(workArea.start, timelinePx, fps),
                width: Math.max(1, timeToX(workArea.end - workArea.start, timelinePx, fps)),
              }}
            >
              <span className="timeline-work-area-edge is-in absolute inset-y-0 left-0" />
              <span className="timeline-work-area-edge is-out absolute inset-y-0 right-0" />
            </div>
          )}

          <div className="flex h-6 border-b border-border/80 bg-surface/90">
            <div
              data-label
              className="sticky left-0 z-10 flex shrink-0 items-center justify-between border-r border-border bg-surface px-2 text-[10px] text-muted"
              style={{ width: labelWidth }}
            >
              <span>标记</span>
              <span className="font-mono">{markers.length}</span>
            </div>
            <div className="timeline-track-grid relative h-full" data-track-area style={{ width }}>
              {markers.map((marker) => (
                <TimelineMarkerChip
                  key={marker.id}
                  marker={marker}
                  left={timeToX(marker.t, timelinePx, fps)}
                  fps={fps}
                  onMove={(next) => moveMarker(marker.id, next)}
                  onSeek={() => setTime(marker.t)}
                  onRename={(name) => renameMarker(marker.id, name)}
                  onRemove={() => removeMarker(marker.id)}
                  timeFromClient={timeFromClient}
                  format={(value) => formatTimelineTime(value, fps, timeDisplayMode)}
                />
              ))}
            </div>
          </div>

          {graphMode && (
            <ValueGraphEditor
              layer={selectedLayer}
              duration={duration}
              fps={fps}
              labelWidth={labelWidth}
              width={labelWidth + width}
            />
          )}

          {!graphMode && layers.length === 0 && (
            <p className="px-3 py-6 text-sm text-muted">
              还没有图层。添加形状后，在这里展开属性并打 K。
            </p>
          )}

          {!graphMode &&
            timelineLayerRows.map(({ layer, depth }) => {
              const isGroup = layer.kind === "group";
              const open = isGroup ? expanded[layer.id] !== false : expanded[layer.id] === true;
              const transformKey = `${layer.id}:transform`;
              const transformOpen = expanded[transformKey] !== false;
              const appearanceKey = `${layer.id}:appearance`;
              const appearanceOpen = expanded[appearanceKey] !== false;
              const groups: {
                key: string;
                label: string;
                props: readonly TimelineProp[];
                open: boolean;
              }[] = [
                {
                  key: transformKey,
                  label: "变换",
                  props: TIMELINE_TRANSFORM_PROPS,
                  open: transformOpen,
                },
                { key: appearanceKey, label: "外观", props: STYLE_PROPS, open: appearanceOpen },
              ];
              const keyCount = isGroup
                ? 0
                : PROPS.reduce((n, prop) => n + layer.tracks[prop].length, 0) +
                  (layer.pathKeys?.length ?? 0);
              const groupChildren = isGroup
                ? layers.filter((item) => item.groupId === layer.id)
                : [];
              const parentName = layer.parentId
                ? layers.find((item) => item.id === layer.parentId)?.name
                : undefined;
              const inheritedLock = layerIsLocked(layer, layers) && !layer.locked;
              const groupIn = groupChildren.length
                ? Math.min(
                    ...groupChildren.map((item) => layerClipRange(item, duration, fps).inPoint),
                  )
                : 0;
              const groupOut = groupChildren.length
                ? Math.max(
                    ...groupChildren.map((item) => layerClipRange(item, duration, fps).outPoint),
                  )
                : 0;
              return (
                <div key={layer.id}>
                  <div
                    data-layer-row-id={layer.id}
                    className={`timeline-layer-row flex h-8 border-b border-border ${selectedLayerIds.includes(layer.id) ? "is-active" : ""} ${isGroup ? "bg-surface-2/45" : ""}`}
                  >
                    <div
                      data-label
                      className={`timeline-layer-label sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-border bg-surface px-1 ${selectedLayerIds.includes(layer.id) ? "is-active" : ""}`}
                      style={{ width: labelWidth }}
                    >
                      <button
                        type="button"
                        aria-label={
                          open
                            ? isGroup
                              ? "折叠编组"
                              : "折叠属性"
                            : isGroup
                              ? "展开编组"
                              : "展开属性"
                        }
                        onClick={() => toggleExpanded(layer.id)}
                        className="grid size-7 place-items-center text-muted"
                      >
                        {open ? (
                          <ChevronDown className="size-3.5" />
                        ) : (
                          <ChevronRight className="size-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={layer.visible ? "隐藏" : "显示"}
                        onClick={() => toggleVisible(layer.id)}
                        className="grid size-7 place-items-center text-muted"
                      >
                        {layer.visible ? (
                          <Eye className="size-3.5" />
                        ) : (
                          <EyeOff className="size-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={
                          inheritedLock ? "图层由编组锁定" : layer.locked ? "解锁图层" : "锁定图层"
                        }
                        aria-pressed={Boolean(layer.locked)}
                        title={
                          inheritedLock
                            ? "此图层由上级编组锁定；请在编组行解锁"
                            : layer.locked
                              ? "已锁定：解锁以编辑图层"
                              : "锁定图层，阻止画布、片段和关键帧编辑"
                        }
                        disabled={inheritedLock}
                        onClick={() => toggleLayerLocked(layer.id)}
                        className={`grid size-6 shrink-0 place-items-center rounded disabled:cursor-not-allowed disabled:opacity-50 ${layer.locked || inheritedLock ? "text-primary" : "text-muted hover:bg-surface hover:text-fg"}`}
                      >
                        {layer.locked || inheritedLock ? (
                          <LockKeyhole className="size-3.5" />
                        ) : (
                          <LockKeyholeOpen className="size-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={layer.solo ? "取消独奏图层" : "独奏图层"}
                        aria-pressed={Boolean(layer.solo)}
                        title={layer.solo ? "独奏已开启，点击取消" : "独奏此图层"}
                        onClick={() => toggleLayerSolo(layer.id)}
                        className={`grid size-6 shrink-0 place-items-center rounded ${layer.solo ? "bg-key/15 text-key" : "text-muted hover:bg-surface hover:text-fg"}`}
                      >
                        <CircleDot className={`size-3.5 ${layer.solo ? "fill-current" : ""}`} />
                      </button>
                      <TimelineLayerOrderHandle layerId={layer.id} />
                      {isGroup && <Folder className="size-3.5 shrink-0 text-primary" />}
                      <TimelineLayerName
                        layer={layer}
                        selected={selectedLayerIds.includes(layer.id)}
                        depth={depth}
                        onSelect={(mode) => selectLayer(layer.id, mode)}
                      />
                      {layer.kind === "path" && (
                        <button
                          type="button"
                          title="在当前时间添加路径关键帧"
                          aria-label="添加路径关键帧"
                          onClick={(event) => {
                            event.stopPropagation();
                            addPathKey(layer.id);
                          }}
                          className="ml-1 rounded border border-key/30 px-1 text-[9px] font-semibold leading-4 text-key hover:bg-key/10"
                        >
                          K
                        </button>
                      )}
                      {parentName && (
                        <span title={`父级：${parentName}`}>
                          <Link2
                            aria-label={`父级：${parentName}`}
                            className="size-3 shrink-0 text-primary/75"
                          />
                        </span>
                      )}
                      {keyCount > 0 && (
                        <span className="mr-1 font-mono text-xs text-key">{keyCount}</span>
                      )}
                    </div>
                    <div
                      className="timeline-track-grid relative h-full"
                      style={{ width, backgroundSize: `${timelinePx}px 100%` }}
                    >
                      {isGroup ? (
                        groupChildren.length > 0 && (
                          <div
                            data-group-band={layer.id}
                            className="absolute inset-y-1 flex items-center overflow-hidden rounded border border-primary/25 bg-primary/[0.07] px-1.5 text-[9px] text-primary/75"
                            style={{
                              left: Math.round(groupIn * timelinePx),
                              width: Math.max(18, Math.round((groupOut - groupIn) * timelinePx)),
                            }}
                          >
                            <span className="truncate">
                              {layer.name} · {groupChildren.length}
                            </span>
                          </div>
                        )
                      ) : (
                        <TimelineClip
                          layer={layer}
                          duration={duration}
                          fps={fps}
                          px={timelinePx}
                          selected={selectedLayerIds.includes(layer.id)}
                          locked={layerIsLocked(layer, layers)}
                          timeDisplayMode={timeDisplayMode}
                        />
                      )}
                    </div>
                  </div>
                  {!isGroup &&
                    open &&
                    groups.map((group) => (
                      <div key={group.key}>
                        <div className="flex h-7 border-b border-border/70 bg-surface-2/35">
                          <div
                            data-label
                            className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-border bg-surface-2/70 pl-4"
                            style={{ width: labelWidth }}
                          >
                            <button
                              type="button"
                              aria-label={
                                group.open ? `折叠${group.label}属性` : `展开${group.label}属性`
                              }
                              aria-expanded={group.open}
                              onClick={() => toggleExpanded(group.key)}
                              className="grid size-5 place-items-center text-muted hover:text-fg"
                            >
                              {group.open ? (
                                <ChevronDown className="size-3" />
                              ) : (
                                <ChevronRight className="size-3" />
                              )}
                            </button>
                            <span className="text-[11px] font-medium text-muted">
                              {group.label}
                            </span>
                          </div>
                          <div className="h-full" style={{ width }} />
                        </div>
                        {group.open &&
                          group.props.map((prop) => {
                            const onContextMenu = (keys: SelectedKey[], x: number, y: number) => {
                              const current = useDoc.getState().selectedKeys;
                              const alreadySelected = keys.every((key) =>
                                current.some(
                                  (selected) =>
                                    selected.layerId === key.layerId &&
                                    selected.prop === key.prop &&
                                    selected.id === key.id,
                                ),
                              );
                              if (!alreadySelected) useDoc.getState().selectKeys(keys);
                              setKeyMenu({ x, y });
                            };
                            if (prop === "position" || prop === "scaleVector") {
                              return (
                                <VectorTrack
                                  key={prop}
                                  layerId={layer.id}
                                  vector={prop}
                                  width={width}
                                  px={timelinePx}
                                  labelWidth={labelWidth}
                                  timeDisplayMode={timeDisplayMode}
                                  selected={selectedKeys.filter((key) => key.layerId === layer.id)}
                                  onContextMenu={onContextMenu}
                                  onBeginMove={beginKeyMove}
                                />
                              );
                            }
                            return (
                              <PropTrack
                                key={prop}
                                layerId={layer.id}
                                prop={prop}
                                width={width}
                                px={timelinePx}
                                labelWidth={labelWidth}
                                timeDisplayMode={timeDisplayMode}
                                selected={selectedKeys
                                  .filter((key) => key.layerId === layer.id && key.prop === prop)
                                  .map((key) => key.id)}
                                onContextMenu={onContextMenu}
                                onBeginMove={beginKeyMove}
                              />
                            );
                          })}
                      </div>
                    ))}
                  {!isGroup && open && layer.kind === "path" && (
                    <PathTrack
                      layer={layer}
                      width={width}
                      px={timelinePx}
                      labelWidth={labelWidth}
                      fps={fps}
                      timeDisplayMode={timeDisplayMode}
                    />
                  )}
                </div>
              );
            })}

          {!graphMode && marquee && (marquee.width >= 3 || marquee.height >= 3) && (
            <div
              className="timeline-key-marquee pointer-events-none absolute z-40"
              style={{
                left: marquee.left,
                top: marquee.top,
                width: marquee.width,
                height: marquee.height,
              }}
            />
          )}

          <div
            className="pointer-events-none absolute bottom-0 z-30 w-px bg-play"
            style={{ left: labelWidth + timeToX(time, timelinePx, fps), top: 0 }}
          >
            <div className="absolute -left-1.5 top-0 size-0 border-x-[6px] border-t-8 border-x-transparent border-t-play" />
          </div>
        </div>
      </div>
      {keyMenu && (
        <div
          className="fixed inset-0 z-[100]"
          onPointerDown={() => setKeyMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setKeyMenu(null);
          }}
        >
          <div
            role="menu"
            aria-label="关键帧操作"
            className="fixed z-[101] w-52 overflow-hidden rounded-lg border border-border bg-surface p-1.5 shadow-2xl"
            style={{
              left: Math.max(8, Math.min(keyMenu.x, window.innerWidth - 216)),
              top: Math.max(8, Math.min(keyMenu.y, window.innerHeight - 250)),
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="px-2 py-1 text-[10px] font-medium text-muted">
              关键帧操作 · {useDoc.getState().selectedKeys.length || 1} 项
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                copySelectedKeys();
                setKeyMenu(null);
              }}
              className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Copy className="size-3.5 text-muted" />
              复制关键帧 <span className="ml-auto font-mono text-[10px] text-muted">Ctrl+C</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={clipboard.current.length === 0}
              onClick={() => {
                pasteCopiedKeys();
                setKeyMenu(null);
              }}
              className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ClipboardPaste className="size-3.5 text-muted" />
              粘贴到播放头 <span className="ml-auto font-mono text-[10px] text-muted">Ctrl+V</span>
            </button>
            <div className="my-1 h-px bg-border" />
            <div className="px-2 py-1 text-[10px] font-medium text-muted">插值方式</div>
            {INTERPOLATION_MENU.map((item) => (
              <button
                key={item.value}
                type="button"
                role="menuitem"
                onClick={() => {
                  setSelectedInterpolation(item.value);
                  setKeyMenu(null);
                }}
                className={`flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary ${item.value === "bezier" ? "text-primary" : "text-fg"}`}
              >
                {item.value === "bezier" && <Spline className="size-3.5" />}
                {item.label}
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                deleteSelectedKey();
                setKeyMenu(null);
              }}
              className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-danger hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Trash2 className="size-3.5" />
              删除所选关键帧
            </button>
          </div>
        </div>
      )}
      <p className="border-t border-border px-3 py-1 text-xs text-muted">
        片段横拖移动时间 · 层级把手纵拖换层 · 拖动上沿调整高度 · J / K 跳帧 · 框选多选 · 右键缓动
      </p>
    </section>
  );
}

function TimelineLayerOrderHandle({ layerId }: { layerId: string }) {
  const drag = useRef<{ pointerId: number; lastTarget: string | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  const moveLayerToRow = useDoc((state) => state.moveLayerToRow);

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    useDoc.getState().selectLayer(layerId);
    useDoc.getState().beginUndoGroup();
    drag.current = { pointerId: event.pointerId, lastTarget: null };
    setDragging(true);
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-layer-row-id]");
    const targetId = target?.dataset.layerRowId;
    if (!target || !targetId || targetId === layerId) return;
    const rect = target.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    const rowTarget = `${targetId}:${placement}`;
    if (rowTarget === active.lastTarget) return;
    moveLayerToRow(layerId, targetId, placement);
    active.lastTarget = rowTarget;
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    useDoc.getState().endUndoGroup();
  }

  return (
    <button
      type="button"
      aria-label="拖动调整图层层级"
      title="拖动调整层级"
      data-layer-order-handle={layerId}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      className={`grid size-6 shrink-0 touch-none place-items-center rounded text-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-primary active:cursor-grabbing ${dragging ? "cursor-grabbing bg-primary/15 text-primary" : "cursor-grab"}`}
    >
      <GripVertical className="size-3.5" />
    </button>
  );
}

function TimelineLayerName({
  layer,
  selected,
  depth,
  onSelect,
}: {
  layer: Layer;
  selected: boolean;
  depth: number;
  onSelect: (mode: "replace" | "toggle" | "range") => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const rename = useDoc((state) => state.rename);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (save) rename(layer.id, draft.trim() || layer.name);
    else setDraft(layer.name);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label="图层名称"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        }}
        className="min-w-0 flex-1 rounded border border-primary/60 bg-bg px-1 text-left text-xs text-fg outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      title="单击选择 · 双击重命名"
      onClick={(event) =>
        onSelect(event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "replace")
      }
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        finished.current = false;
        setDraft(layer.name);
        setEditing(true);
      }}
      className={`min-w-0 flex-1 truncate text-left text-xs font-medium ${selected ? "text-primary" : "text-fg"}`}
      style={{ paddingLeft: depth * 10 }}
    >
      {layer.name}
    </button>
  );
}

function Ruler({
  duration,
  fps,
  px,
  width,
  timeDisplayMode,
}: {
  duration: number;
  fps: number;
  px: number;
  width: number;
  timeDisplayMode: TimeDisplayMode;
}) {
  const lastFrame = Math.max(0, Math.round(duration * fps));
  const pxPerFrame = px / fps;
  const baseSteps = [1, 2, 3, 6, 15, 30, 60, 90, 150, 300, 600, 900];
  const majorSteps =
    timeDisplayMode === "frames"
      ? [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 500, 1000]
      : [...new Set(baseSteps.map((step) => Math.max(1, Math.round((step * fps) / 30))))].sort(
          (a, b) => a - b,
        );
  const majorStep = majorSteps.find((step) => step * pxPerFrame >= 40) ?? majorSteps.at(-1)!;
  const minorSteps =
    timeDisplayMode === "frames"
      ? [1, 2, 5, 10, 15, 20, 25, 30, 50, 75, 100, 150, 250, 500]
      : [
          ...new Set(
            baseSteps.slice(0, 6).map((step) => Math.max(1, Math.round((step * fps) / 30))),
          ),
        ].sort((a, b) => a - b);
  const minorStep =
    minorSteps.find(
      (step) => step <= majorStep && majorStep % step === 0 && step * pxPerFrame >= 6,
    ) ?? majorStep;
  const endpointRemainder = lastFrame % majorStep;
  const labelEndpoint = endpointRemainder === 0 || endpointRemainder * pxPerFrame >= 40;
  const frames: number[] = [];
  for (let frame = 0; frame <= lastFrame; frame += minorStep) frames.push(frame);
  if (frames.at(-1) !== lastFrame) frames.push(lastFrame);

  return (
    <div className="timeline-ruler relative h-full" style={{ width }}>
      {frames.map((frame) => {
        const major = frame % majorStep === 0;
        const endpointAllowed = timeDisplayMode === "timecode" || frame % 5 === 0;
        const label = major || (frame === lastFrame && labelEndpoint && endpointAllowed);
        const time = frame / fps;
        return (
          <span
            key={frame}
            data-ruler-frame={frame}
            data-ruler-major={major ? "true" : "false"}
            className="absolute top-0 h-full"
            style={{ left: frameToX(frame, px, fps) }}
          >
            <span
              className={`timeline-ruler-tick absolute bottom-0 left-0 ${major ? "is-major" : ""}`}
            />
            {label && (
              <span
                title={formatTimelineTime(time, fps, timeDisplayMode)}
                className={`timeline-ruler-label absolute left-1 top-0.5 whitespace-nowrap font-mono text-[11px] tabular-nums ${major ? "is-major" : ""}`}
              >
                {formatRulerTime(frame, fps, timeDisplayMode)}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function PathTrack({
  layer,
  width,
  px,
  labelWidth,
  fps,
  timeDisplayMode,
}: {
  layer: Layer;
  width: number;
  px: number;
  labelWidth: number;
  fps: number;
  timeDisplayMode: TimeDisplayMode;
}) {
  const duration = useDoc((state) => state.duration);
  const selected = useDoc((state) => state.selectedPathKey);
  const selectPathKey = useDoc((state) => state.selectPathKey);
  const movePathKey = useDoc((state) => state.movePathKey);
  const setTime = useDoc((state) => state.setTime);
  const addPathKey = useDoc((state) => state.addPathKey);
  const keys = [...(layer.pathKeys ?? [])].sort((a, b) => a.t - b.t);
  const clip = layerClipRange(layer, duration, fps);
  const growth = layer.pathGrowth;
  const growthStart = clip.inPoint + Math.max(0, growth?.delay ?? 0);
  const growthEnd = Math.min(clip.outPoint, growthStart + Math.max(1 / fps, growth?.duration ?? 1));
  const growthWidth = Math.max(0, (growthEnd - growthStart) * px);

  return (
    <div className="flex h-8 border-b border-border/70">
      <div
        data-label
        className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-border bg-surface px-1.5"
        style={{ width: labelWidth }}
      >
        <span className="w-11 shrink-0 text-[11px] text-muted">路径</span>
        <span className="ml-auto pr-2 font-mono text-[9px] text-muted">{keys.length} K</span>
      </div>
      <div
        data-track-area
        className="timeline-track-grid relative h-full"
        style={{ width, backgroundSize: `${px}px 100%` }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setTime(xToTime(event.clientX - rect.left, px, duration, fps));
          addPathKey(layer.id);
        }}
      >
        {growth?.enabled && growthWidth > 0 && (
          <div
            aria-hidden="true"
            title={growth.direction === "both" ? "路径两端向中间生长" : "路径从起点生长"}
            className="pointer-events-none absolute top-2.5 h-3 rounded border border-primary/35 bg-primary/15"
            style={{ left: growthStart * px, width: growthWidth }}
          />
        )}
        {keys.map((key) => (
          <PathKeyMarker
            key={key.id}
            layerId={layer.id}
            frame={key}
            px={px}
            fps={fps}
            duration={duration}
            timeDisplayMode={timeDisplayMode}
            selected={selected?.layerId === layer.id && selected.id === key.id}
            onSelect={() => selectPathKey({ layerId: layer.id, id: key.id })}
            onMove={(time) => movePathKey(layer.id, key.id, time)}
          />
        ))}
      </div>
    </div>
  );
}

function PathKeyMarker({
  layerId,
  frame,
  px,
  fps,
  duration,
  timeDisplayMode,
  selected,
  onSelect,
  onMove,
}: {
  layerId: string;
  frame: PathKeyframe;
  px: number;
  fps: number;
  duration: number;
  timeDisplayMode: TimeDisplayMode;
  selected: boolean;
  onSelect: () => void;
  onMove: (time: number) => void;
}) {
  const drag = useRef<{ pointerId: number; x: number; time: number } | null>(null);
  return (
    <button
      type="button"
      data-key
      data-path-key-id={frame.id}
      data-layer-id={layerId}
      aria-label={`路径关键帧 · ${frame.points.length} 个锚点 @ ${formatTimelineTime(frame.t, fps, timeDisplayMode)}`}
      title={`路径 · ${formatTimelineTime(frame.t, fps, timeDisplayMode)} · ${frame.interp} · 拖动移动`}
      className={`tl-key interp-${frame.interp} ${selected ? "is-selected" : ""}`}
      style={{ left: timeToX(frame.t, px, fps) }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        drag.current = { pointerId: event.pointerId, x: event.clientX, time: frame.t };
        event.currentTarget.setPointerCapture(event.pointerId);
        onSelect();
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        const delta = (event.clientX - start.x) / Math.max(1, px);
        if (Math.abs(delta) >= 0.5 / fps) onMove(snapTime(start.time + delta, duration, fps));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId === event.pointerId) drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        onMove(frame.t + (event.key === "ArrowLeft" ? -1 : 1) / fps);
      }}
    />
  );
}

function PropTrack({
  layerId,
  prop,
  width,
  px,
  labelWidth,
  timeDisplayMode,
  selected,
  onContextMenu,
  onBeginMove,
}: {
  layerId: string;
  prop: PropKey;
  width: number;
  px: number;
  labelWidth: number;
  timeDisplayMode: TimeDisplayMode;
  selected: string[];
  onContextMenu: (keys: SelectedKey[], x: number, y: number) => void;
  onBeginMove: (
    event: ReactPointerEvent<HTMLButtonElement>,
    startTime: number,
    keys: SelectedKey[],
  ) => void;
}) {
  const track = useDoc((s) => s.layers.find((l) => l.id === layerId)?.tracks[prop] ?? []);
  const time = useDoc((s) => s.time);
  const duration = useDoc((s) => s.duration);
  const fps = useDoc((s) => s.fps);
  const toggleKey = useDoc((s) => s.toggleKey);
  const layer = useDoc((s) => s.layers.find((l) => l.id === layerId));
  const setDisplayed = useDoc((s) => s.setDisplayed);
  const armed = layer?.armed[prop];
  const live = keyNear(track, time, fps);

  return (
    <div className="flex h-8 border-b border-border/70">
      <div
        data-label
        className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-border bg-surface px-1.5"
        style={{ width: labelWidth }}
      >
        <span className={`w-11 shrink-0 text-[11px] ${armed ? "text-fg" : "text-muted"}`}>
          {PROP_LABEL[prop]}
        </span>
        <KeyNav layerId={layerId} prop={prop} compact />
        {prop === "fill" || prop === "stroke" ? (
          <ColorControl
            prop={prop}
            value={layer ? displayed(layer, prop, time, fps) : 0}
            onChange={(value) => setDisplayed(layerId, prop, value)}
          />
        ) : (
          <NumericScrub
            prop={prop}
            value={layer ? displayed(layer, prop, time, fps) : 0}
            onChange={(value) => setDisplayed(layerId, prop, value)}
          />
        )}
      </div>
      <div
        data-track-area
        className="timeline-track-grid relative h-full"
        style={{ width, backgroundSize: `${px}px 100%` }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          const scroller = event.currentTarget.closest(".overflow-auto") as HTMLElement | null;
          if (!scroller) {
            toggleKey(layerId, prop);
            return;
          }
          const rect = scroller.getBoundingClientRect();
          const x = event.clientX - rect.left + scroller.scrollLeft - labelWidth;
          useDoc.getState().setTime(xToTime(x, px, duration, fps));
          toggleKey(layerId, prop);
        }}
      >
        {track.map((kf) => (
          <button
            key={kf.id}
            type="button"
            data-key
            data-key-id={kf.id}
            data-layer-id={layerId}
            data-prop={prop}
            aria-label={`${PROP_LABEL[prop]} ${formatKeyValue(prop, kf.v)} @ ${formatTimelineTime(kf.t, fps, timeDisplayMode)}`}
            title={`${PROP_LABEL[prop]} ${formatKeyValue(prop, kf.v)} @ ${formatTimelineTime(kf.t, fps, timeDisplayMode)} · ${kf.interp}`}
            className={`tl-key interp-${kf.interp} ${selected.includes(kf.id) || live?.id === kf.id ? "is-selected" : ""}`}
            style={{ left: timeToX(kf.t, px, fps) }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onContextMenu([{ layerId, prop, id: kf.id }], event.clientX, event.clientY);
            }}
            onPointerDown={(event) => onBeginMove(event, kf.t, [{ layerId, prop, id: kf.id }])}
          />
        ))}
      </div>
    </div>
  );
}

function VectorTrack({
  layerId,
  vector,
  width,
  px,
  labelWidth,
  timeDisplayMode,
  selected,
  onContextMenu,
  onBeginMove,
}: {
  layerId: string;
  vector: "position" | "scaleVector";
  width: number;
  px: number;
  labelWidth: number;
  timeDisplayMode: TimeDisplayMode;
  selected: SelectedKey[];
  onContextMenu: (keys: SelectedKey[], x: number, y: number) => void;
  onBeginMove: (
    event: ReactPointerEvent<HTMLButtonElement>,
    startTime: number,
    keys: SelectedKey[],
  ) => void;
}) {
  const primary: PropKey = vector === "position" ? "x" : "scale";
  const secondary: PropKey = vector === "position" ? "y" : "scaleY";
  const title = vector === "position" ? "位置" : "缩放";
  const layer = useDoc((state) => state.layers.find((item) => item.id === layerId));
  const primaryTrack = useDoc(
    (state) => state.layers.find((item) => item.id === layerId)?.tracks[primary] ?? [],
  );
  const secondaryTrack = useDoc(
    (state) => state.layers.find((item) => item.id === layerId)?.tracks[secondary] ?? [],
  );
  const time = useDoc((state) => state.time);
  const fps = useDoc((state) => state.fps);

  const markers = new Map<number, { t: number; primary?: Keyframe; secondary?: Keyframe }>();
  for (const key of primaryTrack) {
    const frame = Math.round(key.t * fps);
    const marker = markers.get(frame) ?? { t: frame / fps };
    marker.primary = key;
    markers.set(frame, marker);
  }
  for (const key of secondaryTrack) {
    const frame = Math.round(key.t * fps);
    const marker = markers.get(frame) ?? { t: frame / fps };
    marker.secondary = key;
    markers.set(frame, marker);
  }

  const changeValue = (prop: PropKey, value: number) => {
    const state = useDoc.getState();
    const current = state.layers.find((item) => item.id === layerId);
    if (!current) return;
    const currentPrimary = displayed(current, primary, state.time, state.fps);
    const currentSecondary = displayed(current, secondary, state.time, state.fps);
    let nextPrimary = currentPrimary;
    let nextSecondary = currentSecondary;
    if (prop === primary) nextPrimary = value;
    else nextSecondary = value;
    if (vector === "scaleVector" && current.scaleLinked !== false) {
      if (prop === primary) {
        const ratio = currentPrimary === 0 ? 1 : currentSecondary / currentPrimary;
        nextSecondary = Math.min(10, Math.max(0.01, value * ratio));
      } else {
        const ratio = currentSecondary === 0 ? 1 : currentPrimary / currentSecondary;
        nextPrimary = Math.min(10, Math.max(0.01, value * ratio));
      }
    }
    const forceKey = state.autoKey || current.armed[primary] || current.armed[secondary];
    state.setDisplayed(layerId, primary, nextPrimary, forceKey);
    state.setDisplayed(layerId, secondary, nextSecondary, forceKey);
  };

  const addPairKey = (targetTime: number) => {
    const state = useDoc.getState();
    state.setTime(targetTime);
    const current = state.layers.find((item) => item.id === layerId);
    if (!current) return;
    state.setDisplayed(layerId, primary, displayed(current, primary, targetTime, state.fps), true);
    state.setDisplayed(
      layerId,
      secondary,
      displayed(current, secondary, targetTime, state.fps),
      true,
    );
  };

  return (
    <div className="flex h-8 border-b border-border/70">
      <div
        data-label
        className="sticky left-0 z-10 flex shrink-0 items-center gap-0.5 border-r border-border bg-surface px-1"
        style={{ width: labelWidth }}
      >
        <span
          className={`w-8 shrink-0 text-[10px] ${layer?.armed[primary] || layer?.armed[secondary] ? "text-fg" : "text-muted"}`}
        >
          {title}
        </span>
        <VectorKeyNav layerId={layerId} primary={primary} secondary={secondary} title={title} />
        <div className="ml-auto flex min-w-0 items-center gap-0.5">
          <AxisScrub axis="X" prop={primary} layer={layer} time={time} onChange={changeValue} />
          {vector === "scaleVector" && (
            <button
              type="button"
              aria-label={layer?.scaleLinked !== false ? "解锁缩放比例" : "锁定缩放比例"}
              aria-pressed={layer?.scaleLinked !== false}
              title={
                layer?.scaleLinked !== false
                  ? "缩放比例已锁定，点击解锁"
                  : "缩放比例未锁定，点击锁定"
              }
              onClick={() => useDoc.getState().toggleScaleLinked(layerId)}
              className={`grid size-5 shrink-0 place-items-center rounded ${layer?.scaleLinked !== false ? "text-primary" : "text-muted hover:text-fg"}`}
            >
              {layer?.scaleLinked !== false ? (
                <LockKeyhole className="size-3" />
              ) : (
                <LockKeyholeOpen className="size-3" />
              )}
            </button>
          )}
          <AxisScrub axis="Y" prop={secondary} layer={layer} time={time} onChange={changeValue} />
        </div>
      </div>
      <div
        data-track-area
        className="timeline-track-grid relative h-full"
        style={{ width, backgroundSize: `${px}px 100%` }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          const scroller = event.currentTarget.closest(".overflow-auto") as HTMLElement | null;
          if (!scroller) return;
          const rect = scroller.getBoundingClientRect();
          const x = event.clientX - rect.left + scroller.scrollLeft - labelWidth;
          const state = useDoc.getState();
          const targetTime = xToTime(x, px, state.duration, state.fps);
          const current = state.layers.find((item) => item.id === layerId);
          if (!current) return;
          state.setTime(targetTime);
          const a = keyNear(current.tracks[primary], targetTime, state.fps);
          const b = keyNear(current.tracks[secondary], targetTime, state.fps);
          if (a && b) {
            state.toggleKey(layerId, primary);
            state.toggleKey(layerId, secondary);
          } else {
            addPairKey(targetTime);
          }
        }}
      >
        {[...markers.values()]
          .sort((a, b) => a.t - b.t)
          .map((marker) => {
            const markerKeys: SelectedKey[] = [
              ...(marker.primary ? [{ layerId, prop: primary, id: marker.primary.id }] : []),
              ...(marker.secondary ? [{ layerId, prop: secondary, id: marker.secondary.id }] : []),
            ];
            const active = markerKeys.some((key) =>
              selected.some(
                (item) =>
                  item.layerId === key.layerId && item.prop === key.prop && item.id === key.id,
              ),
            );
            const markerValue = (prop: PropKey, key: Keyframe | undefined) => {
              if (!layer) return 0;
              if (!key) return displayed(layer, prop, marker.t, fps);
              if (vector === "position" && (prop === "x" || prop === "y")) {
                return (prop === "x" ? layer.x : layer.y) + key.v;
              }
              return key.v;
            };
            const primaryValue = formatKeyValue(primary, markerValue(primary, marker.primary));
            const secondaryValue = formatKeyValue(
              secondary,
              markerValue(secondary, marker.secondary),
            );
            const interpolation = combinedInterpolation(marker.primary, marker.secondary);
            return (
              <button
                key={`${marker.t}:${marker.primary?.id ?? ""}:${marker.secondary?.id ?? ""}`}
                type="button"
                data-key
                data-key-pair="true"
                data-pair-primary-id={marker.primary?.id}
                data-pair-secondary-id={marker.secondary?.id}
                data-pair-secondary-prop={secondary}
                data-key-id={marker.primary?.id ?? marker.secondary?.id}
                data-layer-id={layerId}
                data-prop={primary}
                aria-label={`${title} X ${primaryValue}, Y ${secondaryValue} @ ${formatTimelineTime(marker.t, fps, timeDisplayMode)}`}
                title={`${title} X ${primaryValue}, Y ${secondaryValue} @ ${formatTimelineTime(marker.t, fps, timeDisplayMode)} · ${interpolation}`}
                className={`tl-key interp-${interpolation} ${active ? "is-selected" : ""}`}
                style={{ left: timeToX(marker.t, px, fps) }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onContextMenu(markerKeys, event.clientX, event.clientY);
                }}
                onPointerDown={(event) => onBeginMove(event, marker.t, markerKeys)}
              />
            );
          })}
      </div>
    </div>
  );
}

function AxisScrub({
  axis,
  prop,
  layer,
  time,
  onChange,
}: {
  axis: "X" | "Y";
  prop: PropKey;
  layer: Layer | undefined;
  time: number;
  onChange: (prop: PropKey, value: number) => void;
}) {
  const fps = useDoc((state) => state.fps);
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <span className="text-[9px] text-muted">{axis}</span>
      <NumericScrub
        prop={prop}
        value={layer ? displayed(layer, prop, time, fps) : 0}
        onChange={(value) => onChange(prop, value)}
        className="timeline-scrub-value !ml-0 w-[2.65rem] px-0.5 text-[9px]"
      />
    </div>
  );
}

function VectorKeyNav({
  layerId,
  primary,
  secondary,
  title,
}: {
  layerId: string;
  primary: PropKey;
  secondary: PropKey;
  title: string;
}) {
  const time = useDoc((state) => state.time);
  const fps = useDoc((state) => state.fps);
  const layer = useDoc((state) => state.layers.find((item) => item.id === layerId));
  const armed = Boolean(layer?.armed[primary] || layer?.armed[secondary]);
  const hitA = layer ? keyNear(layer.tracks[primary], time, fps) : undefined;
  const hitB = layer ? keyNear(layer.tracks[secondary], time, fps) : undefined;
  const hasKey = Boolean(hitA || hitB);

  const toggleArmed = () => {
    const state = useDoc.getState();
    const current = state.layers.find((item) => item.id === layerId);
    if (!current) return;
    const next = !(current.armed[primary] || current.armed[secondary]);
    if (current.armed[primary] !== next) state.toggleArm(layerId, primary);
    if (current.armed[secondary] !== next) state.toggleArm(layerId, secondary);
  };

  const step = (direction: -1 | 1) => {
    const state = useDoc.getState();
    const current = state.layers.find((item) => item.id === layerId);
    if (!current) return;
    const times = [
      ...new Set([...current.tracks[primary], ...current.tracks[secondary]].map((key) => key.t)),
    ].sort((a, b) => a - b);
    const target =
      direction < 0
        ? [...times].reverse().find((keyTime) => keyTime < state.time - 0.5 / state.fps)
        : times.find((keyTime) => keyTime > state.time + 0.5 / state.fps);
    if (target === undefined) return;
    state.setTime(target);
    const atTarget: SelectedKey[] = [
      ...(keyNear(current.tracks[primary], target, state.fps)
        ? [{ layerId, prop: primary, id: keyNear(current.tracks[primary], target, state.fps)!.id }]
        : []),
      ...(keyNear(current.tracks[secondary], target, state.fps)
        ? [
            {
              layerId,
              prop: secondary,
              id: keyNear(current.tracks[secondary], target, state.fps)!.id,
            },
          ]
        : []),
    ];
    state.selectKeys(atTarget);
  };

  const togglePair = () => {
    const state = useDoc.getState();
    const current = state.layers.find((item) => item.id === layerId);
    if (!current) return;
    if (hitA && hitB) {
      state.toggleKey(layerId, primary);
      state.toggleKey(layerId, secondary);
      return;
    }
    state.setDisplayed(layerId, primary, displayed(current, primary, time, state.fps), true);
    state.setDisplayed(layerId, secondary, displayed(current, secondary, time, state.fps), true);
  };

  return (
    <div className="flex shrink-0 items-center gap-0">
      <button
        type="button"
        title={armed ? `关闭${title}关键帧` : `打开${title}关键帧`}
        aria-pressed={armed}
        onClick={toggleArmed}
        className={`grid size-5 place-items-center rounded ${armed ? "text-key" : "text-muted hover:text-fg"}`}
      >
        <Timer className="size-3" />
      </button>
      <button
        type="button"
        aria-label="上一关键帧"
        onClick={() => step(-1)}
        className="grid size-5 place-items-center text-muted hover:text-fg"
      >
        <ChevronLeft className="size-3" />
      </button>
      <button
        type="button"
        aria-label={hasKey ? "删除关键帧" : "添加关键帧"}
        title={hasKey ? `删除${title}关键帧` : `添加${title}关键帧`}
        aria-pressed={hasKey}
        onClick={togglePair}
        className="grid size-5 place-items-center"
      >
        <span className={`k-diamond ${hitA || hitB ? "is-on" : ""}`} data-time={time} />
      </button>
      <button
        type="button"
        aria-label="下一关键帧"
        onClick={() => step(1)}
        className="grid size-5 place-items-center text-muted hover:text-fg"
      >
        <ChevronRight className="size-3" />
      </button>
    </div>
  );
}

function formatKeyValue(prop: PropKey, value: number): string {
  if (prop === "fill" || prop === "stroke") return numberToColor(value);
  if (prop === "strokeWidth") return `${value.toFixed(1)}px`;
  if (prop === "opacity" || prop === "scale" || prop === "scaleY")
    return `${(value * 100).toFixed(1)}%`;
  if (prop === "rotate") return `${value.toFixed(1)}°`;
  return value.toFixed(1);
}

function ColorControl({
  prop,
  value,
  onChange,
}: {
  prop: "fill" | "stroke";
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="color"
      aria-label={prop === "fill" ? "填充颜色" : "描边颜色"}
      title={prop === "fill" ? "填充颜色" : "描边颜色"}
      value={numberToColor(value)}
      onChange={(event) => onChange(colorToNumber(event.target.value))}
      className="timeline-color-control ml-auto"
    />
  );
}

function NumericScrub({
  prop,
  value,
  onChange,
  className,
}: {
  prop: PropKey;
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const start = useRef<{ x: number; value: number } | null>(null);
  const scrubGrouped = useRef(false);
  const beginUndoGroup = useDoc((s) => s.beginUndoGroup);
  const endUndoGroup = useDoc((s) => s.endUndoGroup);
  const inputRef = useRef<HTMLInputElement>(null);
  const percentValue = prop === "opacity" || prop === "scale" || prop === "scaleY";
  const digits = percentValue ? 3 : 1;
  const step = percentValue ? 0.001 : 0.1;
  const shown =
    prop === "opacity" || prop === "scale" || prop === "scaleY"
      ? `${(value * 100).toFixed(1)}%`
      : prop === "rotate"
        ? `${value.toFixed(1)}°`
        : prop === "strokeWidth"
          ? `${value.toFixed(1)}px`
          : value.toFixed(1);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function scrubTo(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!start.current) return;
    const pixels = event.clientX - start.current.x;
    const sensitivity =
      prop === "opacity" || prop === "scale" || prop === "scaleY"
        ? 0.0025
        : prop === "rotate"
          ? 0.5
          : 1 / 3;
    const modifier = event.shiftKey ? 0.1 : event.altKey ? 10 : 1;
    const raw = start.current.value + pixels * sensitivity * modifier;
    const rounded = Number((Math.round(raw / step) * step).toFixed(digits));
    const next =
      prop === "opacity"
        ? Math.min(1, Math.max(0, rounded))
        : prop === "scale" || prop === "scaleY"
          ? Math.min(10, Math.max(0.01, rounded))
          : prop === "rotate"
            ? Math.min(3600, Math.max(-3600, rounded))
            : prop === "strokeWidth"
              ? Math.min(1000, Math.max(0, rounded))
              : Math.min(100000, Math.max(-100000, rounded));
    onChange(next);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label={`${PROP_LABEL[prop]}数值`}
        type="number"
        step={percentValue ? 0.1 : step}
        value={Number((percentValue ? value * 100 : value).toFixed(percentValue ? 1 : digits))}
        onChange={(event) => {
          const next = Number(event.target.value) || 0;
          onChange(percentValue ? next / 100 : next);
        }}
        onBlur={() => {
          setEditing(false);
          if (scrubGrouped.current) {
            scrubGrouped.current = false;
            endUndoGroup();
          }
        }}
        onFocus={() => {
          if (!scrubGrouped.current) {
            scrubGrouped.current = true;
            beginUndoGroup();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          event.stopPropagation();
        }}
        className="timeline-scrub-input ml-auto w-[4.25rem] rounded border border-primary/50 bg-bg px-1 py-0.5 text-right font-mono text-[10px] text-primary outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`${PROP_LABEL[prop]} ${shown}，拖动微调，双击输入`}
      title="按住拖动调整 · Shift 精细调整 · Alt 加速 · 双击输入"
      className={
        className ??
        "timeline-scrub-value ml-auto min-w-0 truncate rounded px-1 py-0.5 text-right font-mono text-[10px] tabular-nums text-primary hover:bg-primary/10 focus-visible:outline-1 focus-visible:outline-primary"
      }
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        start.current = { x: event.clientX, value };
        scrubGrouped.current = true;
        beginUndoGroup();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) scrubTo(event);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        start.current = null;
        if (scrubGrouped.current) {
          scrubGrouped.current = false;
          endUndoGroup();
        }
      }}
      onPointerCancel={() => {
        start.current = null;
        if (scrubGrouped.current) {
          scrubGrouped.current = false;
          endUndoGroup();
        }
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        onChange(value + (event.key === "ArrowRight" ? step : -step));
      }}
    >
      {shown}
    </button>
  );
}
