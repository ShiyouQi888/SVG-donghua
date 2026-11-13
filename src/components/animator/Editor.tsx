import { useEffect, useState } from "react";
import {
  Circle,
  Maximize2,
  MousePointer2,
  PenTool,
  Redo2,
  Square,
  Star,
  Type,
  Undo2,
  Upload,
} from "lucide-react";
import { FPS, snapTime, type Tool } from "@/lib/animator/model";
import { getProjectAsset, projectAssetImageSource } from "@/lib/animator/project-assets";
import { loadSnapshot, saveSnapshot, useDoc } from "@/lib/animator/store";
import { Stage } from "./Stage";
import { Timeline } from "./Timeline";
import { ExportDialog } from "./ExportDialog";
import { ProjectPanel } from "./ProjectPanel";
import { RightPanel } from "./RightPanel.tsx";

const TOOLS: { id: Tool; label: string; icon: typeof MousePointer2 }[] = [
  { id: "select", label: "选择", icon: MousePointer2 },
  { id: "rect", label: "矩形", icon: Square },
  { id: "circle", label: "圆形", icon: Circle },
  { id: "ellipse", label: "椭圆", icon: Circle },
  { id: "star", label: "五角星", icon: Star },
  { id: "text", label: "文字", icon: Type },
  { id: "pen", label: "钢笔", icon: PenTool },
];

const CANVAS_PRESETS = [
  { name: "横版 Full HD", width: 1920, height: 1080 },
  { name: "横版 HD", width: 1280, height: 720 },
  { name: "竖版 9:16", width: 1080, height: 1920 },
  { name: "正方形 1:1", width: 1080, height: 1080 },
  { name: "人像 4:5", width: 1080, height: 1350 },
  { name: "经典 4:3", width: 1440, height: 1080 },
];

export function Editor() {
  const [exportOpen, setExportOpen] = useState(false);
  const tool = useDoc((s) => s.tool);
  const setTool = useDoc((s) => s.setTool);
  const resetDemo = useDoc((s) => s.resetDemo);
  const clearAll = useDoc((s) => s.clearAll);
  const undo = useDoc((s) => s.undo);
  const redo = useDoc((s) => s.redo);
  const canUndo = useDoc((s) => s.undoCount > 0);
  const canRedo = useDoc((s) => s.redoCount > 0);
  const clearHistory = useDoc((s) => s.clearHistory);
  const replace = useDoc((s) => s.replace);
  const projectWidth = useDoc((s) => s.projectWidth);
  const projectHeight = useDoc((s) => s.projectHeight);
  const exportWidth = useDoc((s) => s.exportWidth);
  const exportHeight = useDoc((s) => s.exportHeight);
  const setProjectSize = useDoc((s) => s.setProjectSize);
  const setExportSize = useDoc((s) => s.setExportSize);

  const placeProjectAsset = async (assetId: string, position?: { x: number; y: number }) => {
    try {
      const asset = await getProjectAsset(assetId);
      if (!asset) throw new Error("素材已不存在");
      const imageSrc = await projectAssetImageSource(asset);
      const state = useDoc.getState();
      const scale = Math.min(
        1,
        (state.projectWidth * 0.82) / asset.width,
        (state.projectHeight * 0.82) / asset.height,
      );
      const width = asset.width * scale;
      const height = asset.height * scale;
      const centerX = Math.min(
        state.projectWidth - width / 2,
        Math.max(width / 2, position?.x ?? state.projectWidth / 2),
      );
      const centerY = Math.min(
        state.projectHeight - height / 2,
        Math.max(height / 2, position?.y ?? state.projectHeight / 2),
      );
      state.addShape("image", centerX, centerY);
      const layerId = useDoc.getState().selectedId;
      if (!layerId) return;
      useDoc.getState().setPaint(layerId, {
        imageSrc,
        x: centerX - width / 2,
        y: centerY - height / 2,
        w: width,
        h: height,
      });
      useDoc.getState().rename(layerId, asset.name);
    } catch {
      window.alert("无法添加这个素材，请重新导入后再试。");
    }
  };

  useEffect(() => {
    const saved = loadSnapshot();
    if (saved) {
      replace(saved);
      clearHistory();
    }
  }, [clearHistory, replace]);

  useEffect(() => {
    let timer = 0;
    const unsub = useDoc.subscribe((state, previous) => {
      if (
        state.duration === previous.duration &&
        state.loop === previous.loop &&
        state.pxPerSec === previous.pxPerSec &&
        state.projectWidth === previous.projectWidth &&
        state.projectHeight === previous.projectHeight &&
        state.exportWidth === previous.exportWidth &&
        state.exportHeight === previous.exportHeight &&
        state.safeArea === previous.safeArea &&
        state.snapEnabled === previous.snapEnabled &&
        state.motionBlur === previous.motionBlur &&
        state.motionBlurStrength === previous.motionBlurStrength &&
        state.layers === previous.layers
      ) {
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        saveSnapshot({
          duration: state.duration,
          loop: state.loop,
          pxPerSec: state.pxPerSec,
          projectWidth: state.projectWidth,
          projectHeight: state.projectHeight,
          exportWidth: state.exportWidth,
          exportHeight: state.exportHeight,
          safeArea: state.safeArea,
          snapEnabled: state.snapEnabled,
          motionBlur: state.motionBlur,
          motionBlurStrength: state.motionBlurStrength,
          layers: state.layers,
        });
      }, 250);
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let wasPlaying = false;
    let frameAccumulator = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      let state = useDoc.getState();
      if (state.playing) {
        if (!wasPlaying) {
          frameAccumulator = 0;
          state.setTime(snapTime(state.time, state.duration));
        }
        frameAccumulator += dt;
        const framesToAdvance = Math.floor(frameAccumulator * FPS + 1e-6);
        if (framesToAdvance > 0) {
          frameAccumulator -= framesToAdvance / FPS;
          state = useDoc.getState();
          const next = state.time + framesToAdvance / FPS;
          if (next >= state.duration) {
            if (state.loop) state.setTime(0);
            else {
              state.setTime(state.duration);
              state.togglePlay();
            }
          } else {
            state.setTime(next);
          }
        }
      } else {
        frameAccumulator = 0;
      }
      wasPlaying = useDoc.getState().playing;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement).tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (event.target as HTMLElement).isContentEditable
      )
        return;
      const state = useDoc.getState();
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
      } else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        state.redo();
      } else if (event.code === "Space") {
        event.preventDefault();
        state.togglePlay();
      } else if (event.key === "j" || event.key === "J") {
        state.stepAny(-1);
      } else if (event.key === "k" || event.key === "K") {
        if (event.shiftKey && state.selectedId) state.punchKeys(state.selectedId);
        else state.stepAny(1);
      } else if (event.key === "f" || event.key === "F") {
        state.easyEase();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (state.selectedKey) state.deleteSelectedKey();
        else if (state.selectedId) state.deleteLayer(state.selectedId);
      } else if (event.key === "v") setTool("select");
      else if (event.key === "ArrowLeft") {
        event.preventDefault();
        state.setTime(state.time - (event.shiftKey ? 0.5 : 1 / 30));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        state.setTime(state.time + (event.shiftKey ? 0.5 : 1 / 30));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTool]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-surface px-3 py-1.5 lg:h-12 lg:flex-nowrap lg:py-0">
        <div className="mr-2 flex shrink-0 items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight">金帧</span>
          <span className="font-mono text-xs text-key">K</span>
        </div>
        <div className="app-scrollbar order-3 flex min-w-0 basis-full items-center gap-1 overflow-x-auto lg:order-none lg:min-w-0 lg:flex-1 lg:basis-auto">
          {TOOLS.map((item) => {
            const Icon = item.icon;
            const on = tool === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTool(item.id)}
                title={
                  item.id === "pen"
                    ? "点击添加锚点，拖动创建曲线手柄；双击或 Enter 完成，Esc 取消"
                    : item.id === "select"
                      ? "选择和移动图层；拖动手柄缩放，按住 Shift 从中心缩放"
                      : item.id === "text"
                        ? "拖动设置文字范围；绘制后双击文字可编辑"
                        : "按住鼠标拖动绘制；按住 Shift 同比绘制"
                }
                className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs ${on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted hover:text-fg"}`}
              >
                <Icon className="size-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-1">
          <button
            type="button"
            aria-label="撤销 Ctrl+Z"
            title="撤销 Ctrl+Z"
            disabled={!canUndo}
            onClick={undo}
            className="grid size-7 place-items-center rounded-md border border-border text-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Undo2 className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="重做 Ctrl+Shift+Z"
            title="重做 Ctrl+Shift+Z"
            disabled={!canRedo}
            onClick={redo}
            className="grid size-7 place-items-center rounded-md border border-border text-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Redo2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={resetDemo}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-fg"
          >
            示例
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-fg"
          >
            清空
          </button>
          <label className="flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-fg">
            <Upload className="size-3.5" />
            导入
            <input
              type="file"
              accept=".svg,image/*"
              aria-label="导入 SVG 或图片"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void importAsset(file);
              }}
            />
          </label>
          <details className="relative">
            <summary className="flex list-none items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
              <Maximize2 className="size-3.5" />
              <span className="hidden sm:inline">画布</span>
              <span className="font-mono">
                {projectWidth}×{projectHeight}
              </span>
            </summary>
            <div className="absolute right-0 top-full z-50 mt-2 w-72 space-y-3 rounded-lg border border-border bg-surface p-3 shadow-2xl">
              <SizeRow
                title="项目尺寸"
                width={projectWidth}
                height={projectHeight}
                onChange={setProjectSize}
              />
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-fg">常用画布预设</span>
                  <span className="text-[10px] text-muted">点选即应用</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {CANVAS_PRESETS.map((preset) => {
                    const active = projectWidth === preset.width && projectHeight === preset.height;
                    return (
                      <button
                        key={preset.name}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setProjectSize(preset.width, preset.height)}
                        className={`flex min-h-11 flex-col items-start justify-center rounded-md border px-2 py-1 text-left transition-colors ${active ? "border-primary/60 bg-primary/10 text-primary" : "border-border bg-bg/50 text-fg hover:border-primary/40 hover:bg-surface-2"}`}
                      >
                        <span className="text-[11px] font-medium">{preset.name}</span>
                        <span className="font-mono text-[10px] text-muted">
                          {preset.width}×{preset.height}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="h-px bg-border" />
              <SizeRow
                title="导出尺寸"
                width={exportWidth}
                height={exportHeight}
                onChange={setExportSize}
              />
              <p className="text-[11px] leading-4 text-muted">
                单位为像素，范围 1–8192。更改项目尺寸时，同步的导出尺寸会一起更新。
              </p>
            </div>
          </details>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-bg"
          >
            导出
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
          <ProjectPanel onPlaceAsset={(assetId) => void placeProjectAsset(assetId)} />
          <Stage onPlaceAsset={(assetId, position) => void placeProjectAsset(assetId, position)} />
          <RightPanel />
        </div>
      </div>
      <Timeline />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}

function SizeRow({
  title,
  width,
  height,
  onChange,
}: {
  title: string;
  width: number;
  height: number;
  onChange: (width: number, height: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted">{title}</span>
      <label className="flex min-w-0 flex-1 items-center gap-1">
        <span className="sr-only">{title}宽度</span>
        <input
          aria-label={`${title}宽度`}
          type="number"
          min={1}
          max={8192}
          step={1}
          value={width}
          onChange={(event) => onChange(Number(event.target.value) || 1, height)}
          className="w-full min-w-0 rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg"
        />
      </label>
      <span className="text-xs text-muted">×</span>
      <label className="flex min-w-0 flex-1 items-center gap-1">
        <span className="sr-only">{title}高度</span>
        <input
          aria-label={`${title}高度`}
          type="number"
          min={1}
          max={8192}
          step={1}
          value={height}
          onChange={(event) => onChange(width, Number(event.target.value) || 1)}
          className="w-full min-w-0 rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg"
        />
      </label>
      <span className="text-[10px] text-muted">px</span>
    </div>
  );
}

async function importAsset(file: File) {
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    await importSvg(file);
    return;
  }
  if (!file.type.startsWith("image/")) return;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const imageSrc = await imageDataUrl(file, bitmap);
    const state = useDoc.getState();
    const scale = Math.min(
      1,
      (state.projectWidth * 0.82) / sourceWidth,
      (state.projectHeight * 0.82) / sourceHeight,
    );
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    state.addShape("image", state.projectWidth / 2, state.projectHeight / 2);
    const id = useDoc.getState().selectedId;
    if (!id) return;
    useDoc.getState().setPaint(id, {
      imageSrc,
      x: (state.projectWidth - width) / 2,
      y: (state.projectHeight - height) / 2,
      w: width,
      h: height,
    });
  } catch {
    window.alert("无法读取这张图片，请尝试 PNG、JPEG、WebP 或 GIF 格式。");
  } finally {
    bitmap?.close();
  }
}

async function imageDataUrl(file: File, bitmap: ImageBitmap): Promise<string> {
  const maxDimension = 2400;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  let source: Blob = file;
  if (scale < 1 || file.size > 2 * 1024 * 1024) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (context) {
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const optimized = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.9),
      );
      if (optimized && (optimized.size < file.size || scale < 1)) source = optimized;
    }
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("图片读取失败"));
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(source);
  });
}

async function importSvg(file: File) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const nodes = [...doc.querySelectorAll("rect,circle,ellipse,text")];
  if (!nodes.length) return;
  const { addShape } = useDoc.getState();
  nodes.slice(0, 24).forEach((node) => {
    const tag = node.tagName.toLowerCase();
    const kind =
      tag === "rect"
        ? "rect"
        : tag === "circle"
          ? "circle"
          : tag === "ellipse"
            ? "ellipse"
            : "text";
    const x = Number(node.getAttribute("x") || node.getAttribute("cx") || 200);
    const y = Number(node.getAttribute("y") || node.getAttribute("cy") || 200);
    addShape(kind, x, y);
    const id = useDoc.getState().selectedId;
    if (!id) return;
    const fill = node.getAttribute("fill");
    if (fill && fill !== "none" && fill.startsWith("#") && fill.length === 7) {
      useDoc.getState().setPaint(id, { fill });
    }
    if (kind === "text") useDoc.getState().setPaint(id, { text: node.textContent || "文字" });
  });
}
