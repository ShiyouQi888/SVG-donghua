import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clipboard, Download, ListPlus, LoaderCircle, Play, Trash2, X } from "lucide-react";
import {
  buildExport,
  type ExportDimensions,
  type Layer,
  type MotionBlurSettings,
} from "@/lib/animator/model";
import { exportGif, exportPng, exportWebm } from "@/lib/animator/media-export";
import { useDoc } from "@/lib/animator/store";

type Format = "svg" | "code" | "png" | "webm" | "gif";
type JobStatus = "queued" | "running" | "ready" | "error";
type ExportSnapshot = {
  layers: Layer[];
  duration: number;
  fps: number;
  dimensions: ExportDimensions;
  motionBlur: MotionBlurSettings;
  transparentBackground: boolean;
  frameTime: number;
};
type ExportJob = {
  id: string;
  format: Format;
  filename: string;
  snapshot: ExportSnapshot;
  status: JobStatus;
  progress: number;
  blob?: Blob;
  error?: string;
};

const FORMATS: { id: Format; label: string; detail: string }[] = [
  { id: "svg", label: "SVG 动画", detail: "矢量 · 可无限放大" },
  { id: "code", label: "SVG 代码", detail: "生成可下载源码" },
  { id: "png", label: "PNG 图片", detail: "当前播放头 · 支持透明" },
  { id: "webm", label: "WebM 视频", detail: "完整动画 · 项目帧率" },
  { id: "gif", label: "GIF 动图", detail: "完整动画 · 项目帧率" },
];

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const exportWidth = useDoc((s) => s.exportWidth);
  const exportHeight = useDoc((s) => s.exportHeight);
  const duration = useDoc((s) => s.duration);
  const fps = useDoc((s) => s.fps);
  const time = useDoc((s) => s.time);
  const [format, setFormat] = useState<Format>("svg");
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [queue, setQueue] = useState<ExportJob[]>([]);
  const nextJobNumber = useRef(1);
  const busyNow = busy || queueBusy;

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyNow) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busyNow, onClose, open]);

  const formats = useMemo(() => FORMATS.map((item) =>
    item.id === "webm" || item.id === "gif"
      ? { ...item, detail: `完整动画 · ${fps} fps` }
      : item,
  ), [fps]);

  if (!open) return null;

  const snapshotCurrent = (): ExportSnapshot => {
    const state = useDoc.getState();
    return {
      layers: JSON.parse(JSON.stringify(state.layers)) as Layer[],
      duration: state.duration,
      fps: state.fps,
      dimensions: {
        projectWidth: state.projectWidth,
        projectHeight: state.projectHeight,
        exportWidth: state.exportWidth,
        exportHeight: state.exportHeight,
      },
      motionBlur: { enabled: state.motionBlur, strength: state.motionBlurStrength },
      transparentBackground: transparent,
      frameTime: state.time,
    };
  };

  const makeBlob = async (
    selectedFormat: Format,
    snapshot: ExportSnapshot,
    onProgress?: (value: number) => void,
  ): Promise<Blob> => {
    if (selectedFormat === "svg" || selectedFormat === "code") {
      const svg = buildExport(snapshot.layers, snapshot.duration, snapshot.dimensions, snapshot.motionBlur, snapshot.transparentBackground, snapshot.fps);
      return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    }
    const options = { ...snapshot, onProgress };
    if (selectedFormat === "png") return exportPng(options);
    if (selectedFormat === "webm") return exportWebm(options);
    return exportGif(options);
  };

  const extensionFor = (selectedFormat: Format) => selectedFormat === "code" || selectedFormat === "svg" ? "svg" : selectedFormat;

  const runExport = async () => {
    const snapshot = snapshotCurrent();
    setError("");
    setProgress(0);
    setCopied(false);
    try {
      if (format === "code") {
        const blob = await makeBlob(format, snapshot);
        setCode(await blob.text());
        return;
      }
      setBusy(true);
      const blob = await makeBlob(format, snapshot, setProgress);
      download(blob, `kairo.${extensionFor(format)}`);
      setProgress(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导出失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  const addToQueue = () => {
    const number = nextJobNumber.current++;
    const snapshot = snapshotCurrent();
    setQueue((current) => [...current, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      format,
      filename: `kairo-${String(number).padStart(2, "0")}.${extensionFor(format)}`,
      snapshot,
      status: "queued",
      progress: 0,
    }]);
    setError("");
  };

  const updateJob = (id: string, update: Partial<ExportJob>) =>
    setQueue((items) => items.map((item) => item.id === id ? { ...item, ...update } : item));

  const runQueue = async () => {
    if (queueBusy || busy) return;
    const pending = queue.filter((job) => job.status === "queued");
    if (!pending.length) return;
    setQueueBusy(true);
    setError("");
    try {
      for (const job of pending) {
        updateJob(job.id, { status: "running", progress: 0, error: undefined });
        try {
          const blob = await makeBlob(job.format, job.snapshot, (value) => updateJob(job.id, { progress: value }));
          updateJob(job.id, { status: "ready", progress: 1, blob });
        } catch (cause) {
          updateJob(job.id, {
            status: "error",
            error: cause instanceof Error ? cause.message : "该导出任务失败。",
          });
        }
      }
    } finally {
      setQueueBusy(false);
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("复制失败，请在代码框中手动全选复制。");
    }
  };

  const queuedCount = queue.filter((job) => job.status === "queued").length;
  const statusLabel: Record<JobStatus, string> = { queued: "等待中", running: "生成中", ready: "已就绪", error: "失败" };

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
      onPointerDown={(event) => { if (event.target === event.currentTarget && !busyNow) onClose(); }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="export-title" className="app-scrollbar max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-surface shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
          <div>
            <h2 id="export-title" className="text-sm font-semibold">导出与队列</h2>
            <p className="mt-0.5 text-[11px] text-muted">输出尺寸 {exportWidth} × {exportHeight} px</p>
          </div>
          <button type="button" aria-label="关闭导出窗口" disabled={busyNow} onClick={onClose} className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50">
            <X className="size-4" />
          </button>
        </header>

        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
            {formats.map((item) => (
              <button key={item.id} type="button" disabled={busyNow} aria-pressed={format === item.id} onClick={() => { setFormat(item.id); setCode(""); setError(""); }} className={`min-h-14 rounded-md border px-2.5 py-2 text-left transition-colors ${format === item.id ? "border-primary bg-primary/10" : "border-border bg-bg/40 hover:border-primary/40"}`}>
                <span className="block text-xs font-medium">{item.label}</span>
                <span className="mt-0.5 block text-[10px] text-muted">{item.detail}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg/40 px-3 py-2">
            <div className="min-w-0">
              <span className="block text-xs font-medium">透明背景</span>
              <span className="text-[10px] text-muted">SVG、PNG、GIF 支持透明像素</span>
            </div>
            <input type="checkbox" checked={transparent} disabled={busyNow} onChange={(event) => setTransparent(event.target.checked)} className="size-4 accent-primary" />
          </div>

          {format === "png" && <p className="text-[11px] text-muted">PNG 导出时间：{time.toFixed(2)} 秒</p>}
          {format === "code" && code && (
            <div className="space-y-2">
              <textarea aria-label="SVG 动画代码" readOnly value={code} className="h-36 w-full resize-y rounded-md border border-border bg-bg p-2.5 font-mono text-[10px] leading-4 text-muted outline-none focus:border-primary" />
              <button type="button" onClick={copyCode} className="flex h-8 items-center gap-2 rounded-md border border-border px-2.5 text-xs text-fg hover:bg-surface-2">
                {copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}{copied ? "已复制" : "复制 SVG 代码"}
              </button>
            </div>
          )}
          {busy && (
            <div className="space-y-1.5" aria-live="polite">
              <div className="flex items-center justify-between text-[11px] text-muted"><span className="flex items-center gap-1.5"><LoaderCircle className="size-3 animate-spin" />正在生成文件…</span><span>{Math.round(progress * 100)}%</span></div>
              <div className="h-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            </div>
          )}
          {error && <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-300">{error}</p>}

          <section className="overflow-hidden rounded-md border border-border bg-bg/30">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="flex items-center gap-2"><h3 className="text-xs font-semibold">导出队列</h3><span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{queue.length}</span></div>
              <div className="flex items-center gap-1.5">
                <button type="button" disabled={busyNow} onClick={addToQueue} className="flex h-7 items-center gap-1 rounded border border-border px-2 text-[10px] text-fg hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"><ListPlus className="size-3.5" />加入当前设置</button>
                <button type="button" disabled={busyNow || queuedCount === 0} onClick={runQueue} className="flex h-7 items-center gap-1 rounded bg-primary px-2 text-[10px] font-medium text-bg disabled:opacity-45"><Play className="size-3" />生成 {queuedCount || "队列"}</button>
                {queue.length > 0 && <button type="button" aria-label="清空导出队列" title="清空导出队列" disabled={busyNow} onClick={() => setQueue([])} className="grid size-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-40"><Trash2 className="size-3.5" /></button>}
              </div>
            </div>
            <div className="app-scrollbar max-h-40 overflow-y-auto">
              {queue.length === 0 ? (
                <p className="px-3 py-4 text-center text-[11px] text-muted">选择格式后加入队列，可一次生成多种尺寸或格式。</p>
              ) : queue.map((job) => (
                <div key={job.id} className="flex items-center gap-2 border-b border-border/70 px-3 py-2 last:border-b-0">
                  <div className={`grid size-6 shrink-0 place-items-center rounded ${job.status === "ready" ? "bg-primary/10 text-primary" : job.status === "error" ? "bg-red-500/10 text-red-300" : "bg-surface-2 text-muted"}`}>
                    {job.status === "running" ? <LoaderCircle className="size-3.5 animate-spin" /> : job.status === "ready" ? <Check className="size-3.5" /> : <span className="text-[9px] font-bold">{job.format.toUpperCase()}</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-[10px] text-fg">{job.filename}</span><span className={`shrink-0 text-[9px] ${job.status === "error" ? "text-red-300" : job.status === "ready" ? "text-primary" : "text-muted"}`}>{statusLabel[job.status]}{job.status === "running" ? ` ${Math.round(job.progress * 100)}%` : ""}</span></div>
                    <p className="truncate text-[9px] text-muted">{job.snapshot.dimensions.exportWidth}×{job.snapshot.dimensions.exportHeight} · {job.snapshot.duration}s · {job.snapshot.fps}fps{job.error ? ` · ${job.error}` : ""}</p>
                  </div>
                  {job.status === "ready" && job.blob ? <button type="button" onClick={() => download(job.blob!, job.filename)} title="下载文件" aria-label={`下载 ${job.filename}`} className="grid size-7 shrink-0 place-items-center rounded border border-primary/30 text-primary hover:bg-primary/10"><Download className="size-3.5" /></button> : job.status === "error" ? <button type="button" disabled={busyNow} onClick={() => updateJob(job.id, { status: "queued", error: undefined, progress: 0 })} className="h-7 shrink-0 rounded border border-border px-2 text-[9px] text-muted hover:text-fg">重试</button> : <span className="w-7 shrink-0" />}
                </div>
              ))}
            </div>
          </section>

          <footer className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-[10px] text-muted">动画时长 {duration} 秒{format === "gif" || format === "webm" ? ` · ${fps} fps` : ""}</p>
            <button type="button" disabled={busyNow} onClick={runExport} className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-bg disabled:cursor-wait disabled:opacity-60">
              <Download className="size-3.5" />{format === "code" ? (code ? "重新生成代码" : "生成代码") : "直接导出"}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
