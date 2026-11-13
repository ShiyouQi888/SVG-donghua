import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Circle,
  Image as ImageIcon,
  PenTool,
  Square,
  Star,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import {
  DEFAULT_BEZIER,
  FONT_FAMILIES,
  PROP_LABEL,
  colorToNumber,
  displayed,
  numberToColor,
  type Interp,
  type Layer,
  type PropKey,
  type ShapeKind,
} from "@/lib/animator/model";
import { useDoc } from "@/lib/animator/store";
import { BezierEditor } from "./BezierEditor";

const INTERP_LABEL: Record<Interp, string> = {
  linear: "线性",
  hold: "定格",
  ease: "缓动",
  bezier: "贝塞尔",
};

const KIND_LABEL: Record<ShapeKind, string> = {
  rect: "矩形",
  circle: "圆形",
  ellipse: "椭圆",
  text: "文字",
  image: "图片",
  star: "五角星",
  path: "钢笔路径",
};

const KIND_ICON: Record<ShapeKind, LucideIcon> = {
  rect: Square,
  circle: Circle,
  ellipse: Circle,
  text: Type,
  image: ImageIcon,
  star: Star,
  path: PenTool,
};

export function Inspector() {
  const layer = useDoc((s) => s.layers.find((l) => l.id === s.selectedId));
  const time = useDoc((s) => s.time);
  const fps = useDoc((s) => s.fps);
  const selectedKey = useDoc((s) => s.selectedKey);
  const setDisplayed = useDoc((s) => s.setDisplayed);
  const setPaint = useDoc((s) => s.setPaint);
  const rename = useDoc((s) => s.rename);
  const deleteLayer = useDoc((s) => s.deleteLayer);
  const patchKey = useDoc((s) => s.patchKey);
  const deleteSelectedKey = useDoc((s) => s.deleteSelectedKey);
  const easyEase = useDoc((s) => s.easyEase);

  if (!layer) {
    return (
      <div className="grid min-h-[240px] place-items-center p-6 text-center">
        <div className="max-w-[190px]">
          <div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl border border-border bg-surface-2/70 text-primary">
            <Square className="size-5" />
          </div>
          <p className="text-sm font-medium text-fg">选择一个图层</p>
          <p className="mt-1.5 text-xs leading-5 text-muted">
            在预览区或时间线上选中图层，即可编辑尺寸、样式和关键帧。
          </p>
        </div>
      </div>
    );
  }

  const keyMeta =
    selectedKey && selectedKey.layerId === layer.id
      ? layer.tracks[selectedKey.prop].find((k) => k.id === selectedKey.id)
      : undefined;
  const LayerIcon = KIND_ICON[layer.kind];

  return (
    <div className="space-y-4 p-3.5 pb-5">
      <div className="overflow-hidden rounded-lg border border-border bg-surface-2/35">
        <div className="flex items-center gap-2.5 px-3 pt-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-md border border-primary/25 bg-primary/10 text-primary">
            <LayerIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium tracking-wide text-muted">所选图层</p>
            <p className="mt-0.5 truncate text-xs text-fg">{KIND_LABEL[layer.kind]}</p>
          </div>
          <span className="rounded-md border border-border bg-bg/70 px-1.5 py-1 text-[10px] text-muted">
            {layer.visible ? "可见" : "隐藏"}
          </span>
        </div>
        <label className="block px-3 pb-3 pt-2.5" htmlFor="layer-name">
          <span className="mb-1 block text-[10px] text-muted">图层名称</span>
          <input
            id="layer-name"
            value={layer.name}
            onChange={(e) => rename(layer.id, e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-bg/70 px-2.5 text-sm text-fg outline-none transition-colors placeholder:text-muted/70 hover:border-primary/35 focus:border-primary/65 focus:ring-2 focus:ring-primary/15"
          />
        </label>
      </div>

      <PositionNudge layer={layer} time={time} fps={fps} setDisplayed={setDisplayed} />

      <PropertySection title="尺寸">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="宽度"
            value={Math.round(layer.w)}
            min={4}
            suffix="px"
            onChange={(value) => setPaint(layer.id, { w: Math.max(4, value) })}
          />
          <NumberField
            label="高度"
            value={Math.round(layer.h)}
            min={4}
            suffix="px"
            onChange={(value) => setPaint(layer.id, { h: Math.max(4, value) })}
          />
        </div>
        {layer.kind === "rect" && (
          <div className="rounded-md border border-border bg-surface-2/25 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted">圆角半径</span>
              <NumberField
                label="圆角半径"
                value={Math.round(Math.min(layer.cornerRadius ?? 8, Math.min(layer.w, layer.h) / 2))}
                min={0}
                max={Math.floor(Math.min(layer.w, layer.h) / 2)}
                suffix="px"
                ariaLabel="矩形圆角"
                onChange={(value) => {
                  const max = Math.floor(Math.min(layer.w, layer.h) / 2);
                  setPaint(layer.id, { cornerRadius: Math.min(max, Math.max(0, value)) });
                }}
                compact
              />
            </div>
            <input
              aria-label="矩形圆角滑块"
              type="range"
              min={0}
              max={Math.max(1, Math.floor(Math.min(layer.w, layer.h) / 2))}
              value={Math.min(layer.cornerRadius ?? 8, Math.floor(Math.min(layer.w, layer.h) / 2))}
              onChange={(event) => setPaint(layer.id, { cornerRadius: Number(event.target.value) })}
              className="timeline-range mt-1 w-full"
            />
          </div>
        )}
      </PropertySection>

      {layer.kind === "text" && (
        <PropertySection title="文字">
          <label className="block space-y-1">
            <span className="text-[10px] text-muted">内容</span>
            <input
              aria-label="文字内容"
              value={layer.text}
              onChange={(e) => setPaint(layer.id, { text: e.target.value })}
              className="h-9 w-full rounded-md border border-border bg-bg/70 px-2.5 text-sm text-fg outline-none transition-colors hover:border-primary/35 focus:border-primary/65 focus:ring-2 focus:ring-primary/15"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] text-muted">字体</span>
            <select
              aria-label="文字字体"
              value={layer.fontFamily ?? FONT_FAMILIES[0].value}
              onChange={(event) => setPaint(layer.id, { fontFamily: event.target.value })}
              className="h-9 w-full rounded-md border border-border bg-bg/70 px-2.5 text-xs text-fg outline-none transition-colors hover:border-primary/35 focus:border-primary/65 focus:ring-2 focus:ring-primary/15"
            >
              {FONT_FAMILIES.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="字号"
              value={layer.fontSize}
              min={8}
              max={160}
              suffix="px"
              onChange={(value) => setPaint(layer.id, { fontSize: value })}
            />
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[10px] text-muted">字重</span>
              <select
                aria-label="文字字重"
                value={layer.fontWeight ?? 600}
                onChange={(event) => setPaint(layer.id, { fontWeight: Number(event.target.value) })}
                className="h-9 w-full rounded-md border border-border bg-bg/70 px-2 text-xs text-fg outline-none transition-colors hover:border-primary/35 focus:border-primary/65 focus:ring-2 focus:ring-primary/15"
              >
                {[300, 400, 500, 600, 700, 800].map((weight) => (
                  <option key={weight} value={weight}>
                    {weight}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </PropertySection>
      )}

      <PropertySection title="填充与描边">
        <div className="grid grid-cols-2 gap-2">
          <ColorField
            label="填充"
            value={layer.fill}
            ariaLabel="填充颜色"
            onChange={(value) => setPaint(layer.id, { fill: value })}
          />
          <ColorField
            label="描边"
            value={layer.stroke}
            ariaLabel="描边颜色"
            onChange={(value) => setPaint(layer.id, { stroke: value })}
          />
        </div>
        <div className="rounded-md border border-border bg-surface-2/25 px-2.5 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-muted">描边粗细</span>
            <span className="font-mono text-[10px] text-fg">{layer.strokeWidth.toFixed(1)} px</span>
          </div>
          <input
            aria-label="描边粗细"
            type="range"
            min={0}
            max={80}
            step={0.5}
            value={layer.strokeWidth}
            onChange={(event) => setPaint(layer.id, { strokeWidth: Number(event.target.value) })}
            className="timeline-range w-full"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted">0</span>
            <input
              aria-label="描边粗细数值"
              type="number"
              min={0}
              max={80}
              step={0.5}
              value={layer.strokeWidth}
              onChange={(event) => setPaint(layer.id, { strokeWidth: Math.max(0, Number(event.target.value) || 0) })}
              className="h-7 w-16 rounded border border-border bg-bg/70 px-1.5 text-right font-mono text-[11px] text-fg outline-none focus:border-primary/65 focus:ring-2 focus:ring-primary/15"
            />
            <span className="text-[10px] text-muted">80 px</span>
          </div>
        </div>
      </PropertySection>

      {keyMeta && selectedKey && (
        <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-medium tracking-wide text-primary">关键帧属性</p>
              <h2 className="mt-0.5 text-xs font-semibold text-fg">{PROP_LABEL[selectedKey.prop]}</h2>
            </div>
            <span className="rounded-md border border-primary/25 bg-primary/10 px-1.5 py-1 font-mono text-[10px] text-primary">
              K
            </span>
          </div>
          <NumberField
            label="时间"
            value={Number(keyMeta.t.toFixed(3))}
            min={0}
            step={1 / fps}
            suffix="s"
            onChange={(value) => patchKey(layer.id, selectedKey.prop, keyMeta.id, { t: value })}
          />
          {selectedKey.prop === "fill" || selectedKey.prop === "stroke" ? (
            <ColorField
              label="关键帧颜色"
              value={numberToColor(keyMeta.v)}
              ariaLabel="关键帧颜色"
              onChange={(value) =>
                patchKey(layer.id, selectedKey.prop, keyMeta.id, { v: colorToNumber(value) })
              }
            />
          ) : (
            <NumberField
              label="数值"
              value={Number(keyMeta.v.toFixed(3))}
              step={selectedKey.prop === "strokeWidth" ? 0.5 : 0.01}
              min={selectedKey.prop === "strokeWidth" ? 0 : undefined}
              suffix={selectedKey.prop === "strokeWidth" ? "px" : undefined}
              onChange={(value) => patchKey(layer.id, selectedKey.prop, keyMeta.id, { v: value })}
            />
          )}
          <label className="block space-y-1">
            <span className="text-[10px] text-muted">插值方式</span>
            <select
              value={keyMeta.interp}
              onChange={(e) =>
                patchKey(layer.id, selectedKey.prop, keyMeta.id, {
                  interp: e.target.value as Interp,
                })
              }
              className="h-9 w-full rounded-md border border-border bg-bg/70 px-2.5 text-xs text-fg outline-none focus:border-primary/65 focus:ring-2 focus:ring-primary/15"
            >
              {(Object.keys(INTERP_LABEL) as Interp[]).map((key) => (
                <option key={key} value={key}>
                  {INTERP_LABEL[key]}
                </option>
              ))}
            </select>
          </label>
          {keyMeta.interp === "bezier" && (
            <BezierEditor
              curve={keyMeta.bezier ?? DEFAULT_BEZIER}
              onChange={(bezier) => patchKey(layer.id, selectedKey.prop, keyMeta.id, { bezier })}
            />
          )}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={easyEase}
              className="h-8 rounded-md border border-border bg-surface/60 text-xs text-fg transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary"
            >
              缓动 F
            </button>
            <button
              type="button"
              onClick={deleteSelectedKey}
              className="h-8 rounded-md border border-border bg-surface/60 text-xs text-danger transition-colors hover:border-danger/45 hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-primary"
            >
              删除 K
            </button>
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => deleteLayer(layer.id)}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-danger/25 bg-danger/5 text-xs font-medium text-danger transition-colors hover:border-danger/50 hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-primary"
      >
        <Trash2 className="size-3.5" />
        删除图层
      </button>
    </div>
  );
}

function PropertySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border/70 pt-3.5">
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-1 rounded-full bg-primary" />
        <h2 className="text-xs font-semibold tracking-wide text-fg">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function NumberField({
  label,
  ariaLabel,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
  compact = false,
}: {
  label: string;
  ariaLabel?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
  compact?: boolean;
}) {
  return (
    <label
      className={
        compact
          ? "flex min-w-[88px] flex-col gap-0.5 rounded-md border border-border bg-bg/70 px-2 py-1 focus-within:border-primary/60"
          : "flex min-w-0 flex-col gap-1 rounded-md border border-border bg-bg/70 px-2 py-1.5 transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10"
      }
    >
      <span className="text-[10px] leading-3 text-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-1">
        <input
          aria-label={ariaLabel ?? label}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-4 w-full min-w-0 bg-transparent text-right font-mono text-xs text-fg outline-none"
        />
        {suffix && <span className="shrink-0 text-[9px] text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

function ColorField({
  label,
  value,
  ariaLabel,
  onChange,
}: {
  label: string;
  value: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-9 min-w-0 items-center gap-1.5 rounded-md border border-border bg-bg/70 px-1.5 transition-colors hover:border-primary/35 focus-within:border-primary/65 focus-within:ring-2 focus-within:ring-primary/10">
      <input
        aria-label={ariaLabel}
        type="color"
        value={value === "none" ? "#000000" : value}
        onChange={(event) => onChange(event.target.value)}
        className="inspector-color-input"
      />
      <span className="text-[10px] text-muted">{label}</span>
      <span className="ml-auto min-w-0 truncate font-mono text-[9px] text-fg">
        {value === "none" ? "无" : value.toUpperCase()}
      </span>
    </label>
  );
}

function PositionNudge({
  layer,
  time,
  fps,
  setDisplayed,
}: {
  layer: Layer;
  time: number;
  fps: number;
  setDisplayed: (id: string, prop: PropKey, value: number) => void;
}) {
  const [step, setStep] = useState(10);
  const steps = [1, 10, 25];
  const cycleStep = () => setStep((current) => steps[(steps.indexOf(current) + 1) % steps.length]);

  function nudge(dx: number, dy: number) {
    setDisplayed(layer.id, "x", displayed(layer, "x", time, fps) + dx * step);
    setDisplayed(layer.id, "y", displayed(layer, "y", time, fps) + dy * step);
  }

  return (
    <section className="rounded-lg border border-border bg-surface-2/30 p-3">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold text-fg">位置微调</h2>
          <p className="mt-1 text-[10px] text-muted">方向键移动图层</p>
        </div>
        <span className="rounded-md border border-border/80 bg-bg/60 px-1.5 py-1 text-[10px] text-muted">
          {step} px / 次
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="grid grid-cols-3 gap-1" aria-label="位置方向控制">
          <span />
          <NudgeButton label="上移" onClick={() => nudge(0, -1)}>
            <ArrowUp className="size-3.5" />
          </NudgeButton>
          <span />
          <NudgeButton label="左移" onClick={() => nudge(-1, 0)}>
            <ArrowLeft className="size-3.5" />
          </NudgeButton>
          <button
            type="button"
            onClick={cycleStep}
            title="切换微调步长"
            aria-label={"切换微调步长，目前 " + step + " 像素"}
            className="grid size-8 place-items-center rounded-md border border-primary/25 bg-primary/10 text-[10px] font-medium text-primary transition-colors hover:border-primary/55 focus-visible:outline-2 focus-visible:outline-primary"
          >
            {step}
          </button>
          <NudgeButton label="右移" onClick={() => nudge(1, 0)}>
            <ArrowRight className="size-3.5" />
          </NudgeButton>
          <span />
          <NudgeButton label="下移" onClick={() => nudge(0, 1)}>
            <ArrowDown className="size-3.5" />
          </NudgeButton>
          <span />
        </div>
        <p className="max-w-[92px] text-right text-[10px] leading-4 text-muted">
          点击中间数值切换微调精度
        </p>
      </div>
    </section>
  );
}

function NudgeButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label + "一个步长"}
      aria-label={label}
      className="grid size-8 place-items-center rounded-md border border-border bg-bg/70 text-muted transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary active:bg-primary/20"
    >
      {children}
    </button>
  );
}
