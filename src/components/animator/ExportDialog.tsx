import { useEffect, useState } from "react";
import { Check, Clipboard, Download, LoaderCircle, X } from "lucide-react";
import {
  buildExport,
  type ExportDimensions,
  type MotionBlurSettings,
} from "@/lib/animator/model";
import { exportGif, exportPng, exportWebm } from "@/lib/animator/media-export";
import { useDoc } from "@/lib/animator/store";

type Format = "svg" | "code" | "png" | "webm" | "gif";

const FORMATS: { id: Format; label: string; detail: string }[] = [
  { id: "svg", label: "SVG 动画", detail: "矢量 · 可无限放大" },
  { id: "code", label: "SVG 代码", detail: "查看并复制源码" },
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
  const [progress, setProgress] = useState(0);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose, open]);

  if (!open) return null;

  const formats = FORMATS.map((item) =>
    item.id === "webm" || item.id === "gif"
      ? { ...item, detail: `完整动画 · ${fps} fps` }
      : item,
  );

  const runExport = async () => {
    const state = useDoc.getState();
    const dimensions: ExportDimensions = {
      projectWidth: state.projectWidth,
      projectHeight: state.projectHeight,
      exportWidth: state.exportWidth,
      exportHeight: state.exportHeight,
    };
    const motionBlur: MotionBlurSettings = {
      enabled: state.motionBlur,
      strength: state.motionBlurStrength,
    };
    const shared = {
      layers: state.layers,
      duration: state.duration,
      fps: state.fps,
      dimensions,
      motionBlur,
      transparentBackground: transparent,
      frameTime: state.time,
      onProgress: setProgress,
    };
    setError("");
    setProgress(0);
    setCopied(false);

    try {
      if (format === "code") {
        setCode(
          buildExport(
            state.layers,
            state.duration,
            dimensions,
            motionBlur,
            transparent,
            state.fps,
          ),
        );
        return;
      }
      setBusy(true);
      if (format === "svg") {
        const svg = buildExport(
          state.layers,
          state.duration,
          dimensions,
          motionBlur,
          transparent,
          state.fps,
        );
        download(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "kairo.svg");
      } else if (format === "png") {
        const png = await exportPng(shared);
        download(png, "kairo.png");
      } else if (format === "webm") {
        const webm = await exportWebm(shared);
        download(webm, "kairo.webm");
      } else {
        const gif = await exportGif(shared);
        download(gif, "kairo.gif");
      }
      setProgress(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导出失败，请重试。");
    } finally {
      setBusy(false);
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

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="export-title" className="text-base font-semibold">导出项目</h2>
            <p className="mt-1 text-xs text-muted">
              输出尺寸 {exportWidth} × {exportHeight} px
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭导出窗口"
            disabled={busy}
            onClick={onClose}
            className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {formats.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                aria-pressed={format === item.id}
                onClick={() => {
                  setFormat(item.id);
                  setCode("");
                  setError("");
                }}
                className={`min-h-[68px] rounded-lg border p-3 text-left transition-colors ${format === item.id ? "border-primary bg-primary/10" : "border-border bg-bg/40 hover:border-primary/40"}`}
              >
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="mt-1 block text-[11px] text-muted">{item.detail}</span>
              </button>
            ))}
          </div>

          <label className="flex items-center justify-between rounded-lg border border-border bg-bg/40 px-3 py-2.5">
            <span>
              <span className="block text-sm font-medium">透明背景</span>
              <span className="mt-0.5 block text-[11px] text-muted">
                SVG、PNG 和 GIF 保留透明像素；WebM 透明度取决于浏览器编码器。
              </span>
            </span>
            <input
              type="checkbox"
              checked={transparent}
              disabled={busy}
              onChange={(event) => setTransparent(event.target.checked)}
              className="size-4 accent-primary"
            />
          </label>

          {format === "png" && (
            <p className="text-xs text-muted">PNG 导出时间：{time.toFixed(2)} 秒</p>
          )}

          {format === "code" && code && (
            <div className="space-y-2">
              <textarea
                aria-label="SVG 动画代码"
                readOnly
                value={code}
                className="h-48 w-full resize-y rounded-lg border border-border bg-bg p-3 font-mono text-[11px] leading-5 text-muted outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={copyCode}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-fg hover:bg-surface-2"
              >
                {copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
                {copied ? "已复制" : "复制 SVG 代码"}
              </button>
            </div>
          )}

          {busy && (
            <div className="space-y-2" aria-live="polite">
              <div className="flex items-center justify-between text-xs text-muted">
                <span className="flex items-center gap-2">
                  <LoaderCircle className="size-3.5 animate-spin" />正在生成文件…
                </span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}
          {error && <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

          <footer className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-[11px] text-muted">
              动画时长 {duration} 秒
              {format === "gif" || format === "webm" ? ` · ${fps} fps` : ""}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={runExport}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-bg disabled:cursor-wait disabled:opacity-60"
            >
              <Download className="size-4" />
              {format === "code" ? (code ? "重新生成代码" : "生成代码") : "导出文件"}
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

