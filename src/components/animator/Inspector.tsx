import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Trash2 } from "lucide-react";
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
} from "@/lib/animator/model";
import { useDoc } from "@/lib/animator/store";
import { BezierEditor } from "./BezierEditor";

const INTERP_LABEL: Record<Interp, string> = {
  linear: "线性",
  hold: "定格",
  ease: "缓动",
  bezier: "贝塞尔",
};

export function Inspector() {
  const layer = useDoc((s) => s.layers.find((l) => l.id === s.selectedId));
  const time = useDoc((s) => s.time);
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
      <div className="grid min-h-36 place-items-center p-4 text-center text-xs leading-5 text-muted">
        选中画布或时间线中的图层后，这里会显示对应属性。
      </div>
    );
  }

  const keyMeta =
    selectedKey && selectedKey.layerId === layer.id
      ? layer.tracks[selectedKey.prop].find((k) => k.id === selectedKey.id)
      : undefined;

  return (
      <div className="space-y-4 p-3">
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="layer-name">
            图层
          </label>
          <input
            id="layer-name"
            value={layer.name}
            onChange={(e) => rename(layer.id, e.target.value)}
            className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-fg"
          />
        </div>

        <PositionNudge layer={layer} time={time} setDisplayed={setDisplayed} />

        <section className="space-y-2">
          <h2 className="text-xs font-medium tracking-wide text-muted">外观</h2>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
              宽
              <input
                type="number"
                value={Math.round(layer.w)}
                onChange={(e) => setPaint(layer.id, { w: Math.max(4, Number(e.target.value)) })}
                className="rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-fg"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
              高
              <input
                type="number"
                value={Math.round(layer.h)}
                onChange={(e) => setPaint(layer.id, { h: Math.max(4, Number(e.target.value)) })}
                className="rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-fg"
              />
            </label>
          </div>
          {layer.kind === "rect" && (
            <label className="block space-y-1.5 text-xs text-muted">
              <span className="flex items-center justify-between">
                圆角半径
                <input
                  aria-label="矩形圆角"
                  type="number"
                  min={0}
                  max={Math.floor(Math.min(layer.w, layer.h) / 2)}
                  value={Math.round(Math.min(layer.cornerRadius ?? 8, Math.min(layer.w, layer.h) / 2))}
                  onChange={(event) => {
                    const max = Math.floor(Math.min(layer.w, layer.h) / 2);
                    setPaint(layer.id, { cornerRadius: Math.min(max, Math.max(0, Number(event.target.value) || 0)) });
                  }}
                  className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-sm text-fg"
                />
              </span>
              <input
                aria-label="矩形圆角滑块"
                type="range"
                min={0}
                max={Math.max(1, Math.floor(Math.min(layer.w, layer.h) / 2))}
                value={Math.min(layer.cornerRadius ?? 8, Math.floor(Math.min(layer.w, layer.h) / 2))}
                onChange={(event) => setPaint(layer.id, { cornerRadius: Number(event.target.value) })}
                className="timeline-range w-full"
              />
            </label>
          )}
          {layer.kind === "text" && (
            <>
              <input
                aria-label="文字内容"
                value={layer.text}
                onChange={(e) => setPaint(layer.id, { text: e.target.value })}
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm"
              />
              <label className="flex items-center justify-between gap-2 text-xs text-muted">
                字体
                <select
                  aria-label="文字字体"
                  value={layer.fontFamily ?? FONT_FAMILIES[0].value}
                  onChange={(event) => setPaint(layer.id, { fontFamily: event.target.value })}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-fg"
                >
                  {FONT_FAMILIES.map((font) => (
                    <option key={font.value} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-muted">
                字号
                <input
                  type="number"
                  min={8}
                  max={160}
                  value={layer.fontSize}
                  onChange={(e) => setPaint(layer.id, { fontSize: Number(e.target.value) })}
                  className="w-20 rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-fg"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted">
                字重
                <select
                  aria-label="文字字重"
                  value={layer.fontWeight ?? 600}
                  onChange={(event) => setPaint(layer.id, { fontWeight: Number(event.target.value) })}
                  className="rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-fg"
                >
                  {[300, 400, 500, 600, 700, 800].map((weight) => (
                    <option key={weight} value={weight}>
                      {weight}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
              填充
              <input
                aria-label="填充颜色"
                type="color"
                value={layer.fill === "none" ? "#000000" : layer.fill}
                onChange={(event) => setPaint(layer.id, { fill: event.target.value })}
                className="h-7 min-w-0 flex-1 cursor-pointer rounded border border-border bg-surface-2 p-0.5"
              />
            </label>
            <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
              描边
              <input
                aria-label="描边颜色"
                type="color"
                value={layer.stroke === "none" ? "#000000" : layer.stroke}
                onChange={(event) => setPaint(layer.id, { stroke: event.target.value })}
                className="h-7 min-w-0 flex-1 cursor-pointer rounded border border-border bg-surface-2 p-0.5"
              />
            </label>
          </div>
          <label className="flex items-center justify-between gap-2 text-xs text-muted">
            描边粗细
            <input
              aria-label="描边粗细"
              type="number"
              min={0}
              max={80}
              step={0.5}
              value={layer.strokeWidth}
              onChange={(event) => setPaint(layer.id, { strokeWidth: Math.max(0, Number(event.target.value) || 0) })}
              className="w-20 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-sm text-fg"
            />
          </label>
        </section>

        {keyMeta && selectedKey && (
          <section className="space-y-2 rounded-md border border-border bg-surface-2 p-2">
            <h2 className="text-xs font-medium text-key">
              选中关键帧 · {PROP_LABEL[selectedKey.prop]}
            </h2>
            <label className="flex items-center gap-2 text-xs text-muted">
              时间
              <input
                type="number"
                step={1 / 30}
                min={0}
                value={Number(keyMeta.t.toFixed(3))}
                onChange={(e) =>
                  patchKey(layer.id, selectedKey.prop, keyMeta.id, { t: Number(e.target.value) })
                }
                className="w-24 rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm text-fg"
              />
            </label>
            {selectedKey.prop === "fill" || selectedKey.prop === "stroke" ? (
              <label className="flex items-center gap-2 text-xs text-muted">
                颜色
                <input
                  type="color"
                  value={numberToColor(keyMeta.v)}
                  onChange={(e) =>
                    patchKey(layer.id, selectedKey.prop, keyMeta.id, {
                      v: colorToNumber(e.target.value),
                    })
                  }
                />
                <span className="font-mono text-fg">{numberToColor(keyMeta.v)}</span>
              </label>
            ) : (
              <label className="flex items-center gap-2 text-xs text-muted">
                数值
                <input
                  type="number"
                  step={selectedKey.prop === "strokeWidth" ? 0.5 : 0.01}
                  min={selectedKey.prop === "strokeWidth" ? 0 : undefined}
                  value={Number(keyMeta.v.toFixed(3))}
                  onChange={(e) =>
                    patchKey(layer.id, selectedKey.prop, keyMeta.id, { v: Number(e.target.value) })
                  }
                  className="w-24 rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm text-fg"
                />
              </label>
            )}
            <label className="flex items-center gap-2 text-xs text-muted">
              插值
              <select
                value={keyMeta.interp}
                onChange={(e) =>
                  patchKey(layer.id, selectedKey.prop, keyMeta.id, {
                    interp: e.target.value as Interp,
                  })
                }
                className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg"
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
            <div className="flex gap-2">
              <button
                type="button"
                onClick={easyEase}
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-bg"
              >
                缓动 F
              </button>
              <button
                type="button"
                onClick={deleteSelectedKey}
                className="rounded-md border border-border px-2 py-1 text-xs text-danger hover:bg-bg"
              >
                删除 K
              </button>
            </div>
          </section>
        )}

        <button
          type="button"
          onClick={() => deleteLayer(layer.id)}
          className="flex w-full items-center justify-center gap-1 rounded-md border border-border py-2 text-sm text-danger hover:bg-surface-2"
        >
          <Trash2 className="size-4" />
          删除图层
        </button>
      </div>
  );
}

function PositionNudge({
  layer,
  time,
  setDisplayed,
}: {
  layer: Layer;
  time: number;
  setDisplayed: (id: string, prop: PropKey, value: number) => void;
}) {
  const [step, setStep] = useState(10);
  const steps = [1, 10, 25];
  const cycleStep = () => setStep((current) => steps[(steps.indexOf(current) + 1) % steps.length]);

  function nudge(dx: number, dy: number) {
    setDisplayed(layer.id, "x", displayed(layer, "x", time) + dx * step);
    setDisplayed(layer.id, "y", displayed(layer, "y", time) + dy * step);
  }

  return (
    <section className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2/60 p-2.5">
      <div className="min-w-0">
        <h2 className="text-xs font-medium text-fg">位置微调</h2>
        <p className="mt-1 text-xs text-muted">方向键移动 · {step}px</p>
      </div>
      <div className="grid grid-cols-3 grid-rows-3 gap-1" aria-label="位置方向控制">
        <span />
        <NudgeButton label="上移" onClick={() => nudge(0, -1)}>
          <ArrowUp className="size-4" />
        </NudgeButton>
        <span />
        <NudgeButton label="左移" onClick={() => nudge(-1, 0)}>
          <ArrowLeft className="size-4" />
        </NudgeButton>
        <button
          type="button"
          onClick={cycleStep}
          title="切换微调步长"
          aria-label={`切换微调步长，目前 ${step} 像素`}
          className="grid size-11 place-items-center rounded-md border border-border bg-surface text-xs font-medium text-muted transition-colors hover:border-primary/60 hover:text-fg focus-visible:outline-2 focus-visible:outline-primary"
        >
          {step}
        </button>
        <NudgeButton label="右移" onClick={() => nudge(1, 0)}>
          <ArrowRight className="size-4" />
        </NudgeButton>
        <span />
        <NudgeButton label="下移" onClick={() => nudge(0, 1)}>
          <ArrowDown className="size-4" />
        </NudgeButton>
        <span />
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
      title={`${label}一个步长`}
      aria-label={label}
      className="grid size-11 place-items-center rounded-md border border-border bg-surface text-muted transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary active:bg-primary/20"
    >
      {children}
    </button>
  );
}
