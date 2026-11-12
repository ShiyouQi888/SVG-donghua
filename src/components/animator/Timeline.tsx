import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Magnet,
  Maximize2,
  Pause,
  Play,
  ScanLine,
  Spline,
  Trash2,
  Waves,
} from "lucide-react";
import {
  DEFAULT_BEZIER,
  FPS,
  PROP_LABEL,
  STYLE_PROPS,
  TRANSFORM_PROPS,
  colorToNumber,
  displayed,
  fmtTime,
  keyNear,
  numberToColor,
  snapTime,
  type Interp,
  type PropKey,
} from "@/lib/animator/model";
import {
  type CopiedKeyframe,
  type KeyframeMove,
  type SelectedKey,
  useDoc,
} from "@/lib/animator/store";
import { KeyNav } from "./KeyNav";

const LABEL_W = 280;
const FIT_MODE_KEY = "kairo-timeline-zoom-mode";
const HEIGHT_KEY = "kairo-timeline-height";
const MIN_TIMELINE_HEIGHT = 160;
const INTERPOLATION_MENU: { value: Interp; label: string }[] = [
  { value: "linear", label: "线性" },
  { value: "ease", label: "缓入缓出" },
  { value: "bezier", label: "贝塞尔曲线" },
  { value: "hold", label: "定格" },
];

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

export function Timeline() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrub = useRef(false);
  const marqueeStart = useRef<MarqueeState | null>(null);
  const resizeStart = useRef<{ y: number; height: number } | null>(null);
  const clipboard = useRef<CopiedKeyframe[]>([]);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [keyMenu, setKeyMenu] = useState<KeyframeMenuState | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [fitWidth, setFitWidth] = useState(true);
  const [timelineHeight, setTimelineHeight] = useState<number | null>(null);

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
  const layers = useDoc((s) => s.layers);
  const expanded = useDoc((s) => s.expanded);
  const duration = useDoc((s) => s.duration);
  const time = useDoc((s) => s.time);
  const px = useDoc((s) => s.pxPerSec);
  const selectedId = useDoc((s) => s.selectedId);
  const selectedKeys = useDoc((s) => s.selectedKeys);
  const playing = useDoc((s) => s.playing);
  const autoKey = useDoc((s) => s.autoKey);
  const snapEnabled = useDoc((s) => s.snapEnabled);
  const safeArea = useDoc((s) => s.safeArea);
  const motionBlur = useDoc((s) => s.motionBlur);
  const motionBlurStrength = useDoc((s) => s.motionBlurStrength);
  const setTime = useDoc((s) => s.setTime);
  const togglePlay = useDoc((s) => s.togglePlay);
  const stop = useDoc((s) => s.stop);
  const setDuration = useDoc((s) => s.setDuration);
  const setPx = useDoc((s) => s.setPx);
  const toggleAutoKey = useDoc((s) => s.toggleAutoKey);
  const toggleSnap = useDoc((s) => s.toggleSnap);
  const toggleSafeArea = useDoc((s) => s.toggleSafeArea);
  const toggleMotionBlur = useDoc((s) => s.toggleMotionBlur);
  const setMotionBlurStrength = useDoc((s) => s.setMotionBlurStrength);
  const punchKeys = useDoc((s) => s.punchKeys);
  const selectLayer = useDoc((s) => s.selectLayer);
  const toggleExpanded = useDoc((s) => s.toggleExpanded);
  const toggleVisible = useDoc((s) => s.toggleVisible);
  const selectKey = useDoc((s) => s.selectKey);
  const selectKeys = useDoc((s) => s.selectKeys);
  const setSelectedInterpolation = useDoc((s) => s.setSelectedInterpolation);
  const deleteSelectedKey = useDoc((s) => s.deleteSelectedKey);

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
  const fittedPx = Math.round(
    Math.min(480, Math.max(40, (viewportWidth - labelWidth - 64) / Math.max(duration, 0.5))),
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
    return snapTime(x / timelinePx, duration);
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
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1.5">
        <button
          type="button"
          onClick={togglePlay}
          className="grid size-9 place-items-center rounded-full bg-primary text-bg"
          aria-label={playing ? "暂停" : "播放"}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <button
          type="button"
          onClick={stop}
          className="rounded-md border border-border px-2 py-1 text-xs"
          aria-label="停止"
        >
          停
        </button>
        <span className="font-mono text-xs text-muted">
          {fmtTime(time)} / {fmtTime(duration)} · {FPS}fps
        </span>
        <button
          type="button"
          disabled={!selectedId}
          onClick={() => selectedId && punchKeys(selectedId)}
          className="rounded-md bg-key px-2.5 py-1 text-xs font-medium text-bg disabled:opacity-40"
          title="给已开秒表的属性在播放头打 K；若都没开，则五个属性一起打"
        >
          打 K 帧
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
          <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted" title="运动模糊强度">
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
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-muted">
            时长
            <input
              type="number"
              min={0.5}
              max={30}
              step={0.5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-14 rounded-md border border-border bg-surface-2 px-1 py-0.5 font-mono text-fg"
            />
            s
          </label>
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
        className="timeline-scroll relative min-h-0 flex-1 overflow-auto"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("[data-key]") || target.closest("[data-label]")) return;
          if (target.closest("[data-track-area]")) {
            if (event.button !== 0 || !scrollRef.current) return;
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
          scrub.current = true;
          setTime(timeFromClient(event.clientX));
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
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
                .map((key) => ({
                  layerId: key.dataset.layerId ?? "",
                  prop: key.dataset.prop as PropKey,
                  id: key.dataset.keyId ?? "",
                }))
                .filter((key) => key.layerId && key.id);
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
        onPointerCancel={() => {
          marqueeStart.current = null;
          setMarquee(null);
          scrub.current = false;
        }}
      >
        <div className="relative" style={{ width: labelWidth + width }}>
          <div className="sticky top-0 z-20 flex h-7 border-b border-border bg-surface-2">
            <div
              data-label
              className="sticky left-0 z-30 flex shrink-0 items-center border-r border-border bg-surface-2 px-2 text-xs text-muted"
              style={{ width: labelWidth }}
            >
              图层 / 变换
            </div>
            <Ruler duration={duration} px={timelinePx} width={width} />
          </div>

          {layers.length === 0 && (
            <p className="px-3 py-6 text-sm text-muted">
              还没有图层。添加形状后，在这里展开属性并打 K。
            </p>
          )}

          {layers.map((layer) => {
            const open = expanded[layer.id] !== false;
            const transformKey = `${layer.id}:transform`;
            const transformOpen = expanded[transformKey] !== false;
            const appearanceKey = `${layer.id}:appearance`;
            const appearanceOpen = expanded[appearanceKey] !== false;
            const groups = [
              { key: transformKey, label: "变换", props: TRANSFORM_PROPS, open: transformOpen },
              { key: appearanceKey, label: "外观", props: STYLE_PROPS, open: appearanceOpen },
            ];
            const keyCount = [...TRANSFORM_PROPS, ...STYLE_PROPS].reduce(
              (n, prop) => n + layer.tracks[prop].length,
              0,
            );
            return (
              <div key={layer.id}>
                <div
                  className={`flex h-8 border-b border-border ${layer.id === selectedId ? "bg-primary/10" : ""}`}
                >
                  <div
                    data-label
                    className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-border bg-surface px-1"
                    style={{ width: labelWidth }}
                  >
                    <button
                      type="button"
                      aria-label={open ? "折叠" : "展开"}
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
                      onClick={() => selectLayer(layer.id)}
                      className="min-w-0 flex-1 truncate text-left text-xs font-medium"
                    >
                      {layer.name}
                    </button>
                    {keyCount > 0 && (
                      <span className="mr-1 font-mono text-xs text-key">{keyCount}</span>
                    )}
                  </div>
                  <div className="relative h-full" style={{ width }} />
                </div>
                {open &&
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
                          <span className="text-[11px] font-medium text-muted">{group.label}</span>
                        </div>
                        <div className="h-full" style={{ width }} />
                      </div>
                      {group.open &&
                        group.props.map((prop) => (
                          <PropTrack
                            key={prop}
                            layerId={layer.id}
                            prop={prop}
                            width={width}
                            px={timelinePx}
                            labelWidth={labelWidth}
                            selected={selectedKeys
                              .filter((key) => key.layerId === layer.id && key.prop === prop)
                              .map((key) => key.id)}
                            onSelect={(keyId, extend) =>
                              selectKey({ layerId: layer.id, prop, id: keyId }, extend)
                            }
                            onContextMenu={(key, x, y) => {
                              const current = useDoc.getState().selectedKeys;
                              const alreadySelected = current.some(
                                (selected) =>
                                  selected.layerId === key.layerId &&
                                  selected.prop === key.prop &&
                                  selected.id === key.id,
                              );
                              if (!alreadySelected) useDoc.getState().selectKey(key);
                              setKeyMenu({ x, y });
                            }}
                          />
                        ))}
                    </div>
                  ))}
              </div>
            );
          })}

          {marquee && (marquee.width >= 3 || marquee.height >= 3) && (
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
            style={{ left: labelWidth + time * timelinePx, top: 0 }}
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
        拖动上沿调整高度 · J / K 跳帧 · 框选/Shift 多选 · 右键缓动 · Ctrl+C / V 复制粘贴
      </p>
    </section>
  );
}

function Ruler({ duration, px, width }: { duration: number; px: number; width: number }) {
  const ticks: number[] = [];
  const step = px >= 140 ? 0.5 : 1;
  for (let t = 0; t <= duration + 0.001; t += step) ticks.push(Number(t.toFixed(2)));
  return (
    <div className="relative h-full" style={{ width }}>
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute top-0 h-full font-mono text-xs text-muted"
          style={{ left: t * px }}
        >
          <span className="absolute bottom-0 left-0 h-2 w-px bg-border" />
          <span className="absolute left-1 top-0.5">{fmtTime(t)}</span>
        </span>
      ))}
    </div>
  );
}

function PropTrack({
  layerId,
  prop,
  width,
  px,
  labelWidth,
  selected,
  onSelect,
  onContextMenu,
}: {
  layerId: string;
  prop: PropKey;
  width: number;
  px: number;
  labelWidth: number;
  selected: string[];
  onSelect: (id: string, extend: boolean) => void;
  onContextMenu: (key: SelectedKey, x: number, y: number) => void;
}) {
  const track = useDoc((s) => s.layers.find((l) => l.id === layerId)?.tracks[prop] ?? []);
  const time = useDoc((s) => s.time);
  const duration = useDoc((s) => s.duration);
  const toggleKey = useDoc((s) => s.toggleKey);
  const layer = useDoc((s) => s.layers.find((l) => l.id === layerId));
  const setDisplayed = useDoc((s) => s.setDisplayed);
  const moveKeys = useDoc((s) => s.moveKeys);
  const dragOrigin = useRef<{ startTime: number; keys: KeyframeMove[] } | null>(null);
  const armed = layer?.armed[prop];
  const live = keyNear(track, time);

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
            value={layer ? displayed(layer, prop, time) : 0}
            onChange={(value) => setDisplayed(layerId, prop, value)}
          />
        ) : (
          <NumericScrub
            prop={prop}
            value={layer ? displayed(layer, prop, time) : 0}
            onChange={(value) => setDisplayed(layerId, prop, value)}
          />
        )}
      </div>
      <div
        data-track-area
        className="relative h-full"
        style={{ width }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          const scroller = event.currentTarget.closest(".overflow-auto") as HTMLElement | null;
          if (!scroller) {
            toggleKey(layerId, prop);
            return;
          }
          const rect = scroller.getBoundingClientRect();
          const x = event.clientX - rect.left + scroller.scrollLeft - labelWidth;
          useDoc.getState().setTime(snapTime(x / px, duration));
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
            aria-label={`${PROP_LABEL[prop]} ${formatKeyValue(prop, kf.v)} @ ${fmtTime(kf.t)}`}
            title={`${PROP_LABEL[prop]} ${formatKeyValue(prop, kf.v)} @ ${fmtTime(kf.t)} · ${kf.interp}`}
            className={`tl-key ${selected.includes(kf.id) || live?.id === kf.id ? "is-selected" : ""}`}
            style={{ left: kf.t * px }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onContextMenu({ layerId, prop, id: kf.id }, event.clientX, event.clientY);
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (event.button !== 0) return;
              const alreadySelected = useDoc
                .getState()
                .selectedKeys.some(
                  (key) => key.layerId === layerId && key.prop === prop && key.id === kf.id,
                );
              if (!alreadySelected || event.shiftKey) onSelect(kf.id, event.shiftKey);
              const state = useDoc.getState();
              const keySelected = state.selectedKeys.some(
                (key) => key.layerId === layerId && key.prop === prop && key.id === kf.id,
              );
              const selection = keySelected ? state.selectedKeys : [{ layerId, prop, id: kf.id }];
              const keys = selection.flatMap((key) => {
                const currentLayer = state.layers.find((item) => item.id === key.layerId);
                const origin = currentLayer?.tracks[key.prop].find((item) => item.id === key.id);
                return origin ? [{ ...key, t: origin.t }] : [];
              });
              dragOrigin.current = { startTime: kf.t, keys };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const origin = dragOrigin.current;
              const scroller = event.currentTarget.closest(".overflow-auto") as HTMLElement | null;
              if (!scroller || !origin) return;
              const rect = scroller.getBoundingClientRect();
              const x = event.clientX - rect.left + scroller.scrollLeft - labelWidth;
              const targetTime = snapTime(x / px, duration);
              moveKeys(origin.keys, targetTime - origin.startTime);
            }}
            onPointerUp={() => {
              dragOrigin.current = null;
            }}
            onPointerCancel={() => {
              dragOrigin.current = null;
            }}
          />
        ))}
      </div>
    </div>
  );
}

function formatKeyValue(prop: PropKey, value: number): string {
  if (prop === "fill" || prop === "stroke") return numberToColor(value);
  if (prop === "strokeWidth") return `${value.toFixed(1)}px`;
  if (prop === "opacity" || prop === "scale") return `${(value * 100).toFixed(1)}%`;
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
}: {
  prop: PropKey;
  value: number;
  onChange: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const start = useRef<{ x: number; value: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const percentValue = prop === "opacity" || prop === "scale";
  const digits = percentValue ? 3 : 1;
  const step = percentValue ? 0.001 : 0.1;
  const shown =
    prop === "opacity" || prop === "scale"
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
      prop === "opacity" || prop === "scale" ? 0.0025 : prop === "rotate" ? 0.5 : 1 / 3;
    const modifier = event.shiftKey ? 0.1 : event.altKey ? 10 : 1;
    const raw = start.current.value + pixels * sensitivity * modifier;
    const rounded = Number((Math.round(raw / step) * step).toFixed(digits));
    const next =
      prop === "opacity"
        ? Math.min(1, Math.max(0, rounded))
        : prop === "scale"
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
        onBlur={() => setEditing(false)}
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
      className="timeline-scrub-value ml-auto min-w-0 truncate rounded px-1 py-0.5 text-right font-mono text-[10px] tabular-nums text-primary hover:bg-primary/10 focus-visible:outline-1 focus-visible:outline-primary"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        start.current = { x: event.clientX, value };
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
      }}
      onPointerCancel={() => {
        start.current = null;
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
