import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Search, Sparkles, Trash2, WandSparkles } from "lucide-react";
import {
  DEFAULT_BEZIER,
  DEFAULT_FONT_FAMILY,
  colorToNumber,
  nid,
  snapTime,
  type Layer,
} from "@/lib/animator/model";
import {
  LAYER_TEMPLATES,
  MOTION_TEMPLATES,
  motionTemplateById,
  type LayerTemplate,
  type MotionTemplate,
  type TemplateCategory,
} from "@/lib/animator/templates";
import { useDoc } from "@/lib/animator/store";

const STORAGE_KEY = "kairo-saved-layer-templates-v1";
const CATEGORIES = ["全部", "标题", "文字", "图形", "版式", "动效", "自定义"] as const;
type CategoryFilter = (typeof CATEGORIES)[number];

type SavedTemplate = LayerTemplate & { savedAt: number };

function readSavedTemplates(): SavedTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedTemplate[];
    return Array.isArray(parsed) ? parsed.filter((item) => item.id && item.name && item.kind) : [];
  } catch {
    return [];
  }
}

function applyMotionPreset(
  layerId: string,
  template: MotionTemplate,
  duration: number,
  fps: number,
) {
  const state = useDoc.getState();
  const layer = state.layers.find((item) => item.id === layerId);
  if (!layer) return;
  state.beginUndoGroup();
  try {
    for (const recipe of template.tracks) {
      const keys = recipe.frames.map((frame) => ({
        id: nid("kf"),
        t: snapTime(duration * frame.at, duration, fps),
        v: typeof frame.value === "string" ? colorToNumber(frame.value) : frame.value,
        interp: frame.interp ?? "ease",
        bezier: { ...DEFAULT_BEZIER },
      }));
      useDoc.getState().setTrack(layerId, recipe.prop, keys);
    }
  } finally {
    useDoc.getState().endUndoGroup();
  }
}

function templateBounds(template: LayerTemplate, width: number, height: number) {
  const w = Math.max(1, Math.round(width * template.widthRatio));
  const h = Math.max(1, Math.round(height * template.heightRatio));
  if (template.position === "full") return { x: 0, y: 0, w: width, h: height };
  if (template.position === "lower-left") {
    return { x: width * 0.08, y: height * 0.78 - h / 2, w, h };
  }
  const y =
    template.position === "upper"
      ? height * 0.2 - h / 2
      : template.position === "lower"
        ? height * 0.78 - h / 2
        : (height - h) / 2;
  return { x: (width - w) / 2, y, w, h };
}

function applyLayerTemplate(template: LayerTemplate) {
  const state = useDoc.getState();
  const bounds = templateBounds(template, state.projectWidth, state.projectHeight);
  state.beginUndoGroup();
  try {
    state.addShape(template.kind, bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, bounds);
    const id = useDoc.getState().selectedId;
    if (!id) return;
    useDoc.getState().setPaint(id, {
      fill: template.fill,
      fillEnabled: template.fillEnabled ?? true,
      stroke: template.stroke,
      strokeEnabled: template.strokeEnabled ?? true,
      strokeWidth: template.strokeWidth,
      cornerRadius: template.cornerRadius,
      ...(template.text === undefined ? {} : { text: template.text }),
      ...(template.fontSize === undefined ? {} : { fontSize: template.fontSize }),
      ...(template.fontWeight === undefined ? {} : { fontWeight: template.fontWeight }),
      ...(template.fontFamily === undefined ? {} : { fontFamily: template.fontFamily }),
    });
    useDoc.getState().rename(id, template.name);
    const motion = motionTemplateById(template.motionId);
    if (motion) {
      const state = useDoc.getState();
      applyMotionPreset(id, motion, state.duration, state.fps);
    }
  } finally {
    useDoc.getState().endUndoGroup();
  }
}

function applyLayerStyle(template: LayerTemplate, layer: Layer) {
  const patch = {
    fill: template.fill,
    fillEnabled: template.fillEnabled ?? true,
    stroke: template.stroke,
    strokeEnabled: template.strokeEnabled ?? true,
    strokeWidth: template.strokeWidth,
    ...(layer.kind === "rect" ? { cornerRadius: template.cornerRadius } : {}),
    ...(layer.kind === "text"
      ? {
          fontFamily: template.fontFamily ?? DEFAULT_FONT_FAMILY,
          ...(template.fontSize === undefined ? {} : { fontSize: template.fontSize }),
          ...(template.fontWeight === undefined ? {} : { fontWeight: template.fontWeight }),
        }
      : {}),
  };
  const state = useDoc.getState();
  state.beginUndoGroup();
  try {
    state.setPaint(layer.id, patch);
  } finally {
    useDoc.getState().endUndoGroup();
  }
}

function TemplateSwatch({ template }: { template: LayerTemplate }) {
  const shape =
    template.kind === "ellipse"
      ? "rounded-[50%]"
      : template.kind === "star"
        ? "rotate-45 rounded-sm"
        : "rounded-md";
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-bg">
      <span
        className={`block h-5 w-6 ${shape}`}
        style={{
          backgroundColor:
            template.fillEnabled === false || template.fill === "none"
              ? "transparent"
              : template.fill,
          border:
            template.strokeEnabled === false
              ? "none"
              : `${Math.max(1, Math.min(3, template.strokeWidth))}px solid ${template.stroke}`,
          borderRadius: template.kind === "rect" ? Math.min(12, template.cornerRadius) : undefined,
        }}
      />
    </span>
  );
}

function LayerTemplateCard({
  template,
  selectedLayer,
  onAdd,
  onApply,
  onDelete,
}: {
  template: LayerTemplate;
  selectedLayer: Layer | undefined;
  onAdd: () => void;
  onApply?: () => void;
  onDelete?: () => void;
}) {
  return (
    <article className="min-w-0 rounded-lg border border-border bg-surface-2/45 p-2.5 transition-colors hover:border-primary/35">
      <div className="flex min-w-0 items-center gap-2">
        <TemplateSwatch template={template} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[11px] font-medium text-fg">{template.name}</h3>
          <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted">
            {template.description}
          </p>
        </div>
        {onDelete && (
          <button
            type="button"
            aria-label={`删除模板 ${template.name}`}
            title="删除自定义模板"
            onClick={onDelete}
            className="grid size-7 shrink-0 place-items-center rounded text-muted hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={onAdd}
          className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-primary/35 bg-primary/10 px-2 text-[10px] font-medium text-primary hover:bg-primary/15"
        >
          <Plus className="size-3" />
          添加图层
        </button>
        {onApply && selectedLayer?.kind !== "image" && selectedLayer?.kind !== "group" && (
          <button
            type="button"
            onClick={onApply}
            className="h-7 rounded-md border border-border px-2 text-[10px] text-muted hover:bg-surface-2 hover:text-fg"
          >
            套用样式
          </button>
        )}
      </div>
    </article>
  );
}

function MotionTemplateCard({
  template,
  onApply,
  disabled,
}: {
  template: MotionTemplate;
  onApply: () => void;
  disabled: boolean;
}) {
  return (
    <article className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface-2/45 p-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-md border border-primary/20 bg-primary/10 text-primary">
        <WandSparkles className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[11px] font-medium text-fg">{template.name}</h3>
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted">
          {template.description}
        </p>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onApply}
        title={disabled ? "先选择一个图层" : `应用${template.name}`}
        className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[10px] text-muted hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Sparkles className="size-3" />
        应用
      </button>
    </article>
  );
}

export function TemplatePanel() {
  const selectedId = useDoc((state) => state.selectedId);
  const selectedLayer = useDoc((state) =>
    state.layers.find((layer) => layer.id === state.selectedId),
  );
  const duration = useDoc((state) => state.duration);
  const fps = useDoc((state) => state.fps);
  const projectWidth = useDoc((state) => state.projectWidth);
  const projectHeight = useDoc((state) => state.projectHeight);
  const [category, setCategory] = useState<CategoryFilter>("全部");
  const [search, setSearch] = useState("");
  const [saved, setSaved] = useState<SavedTemplate[]>([]);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templateName, setTemplateName] = useState("");

  useEffect(() => {
    setSaved(readSavedTemplates());
    setSavedLoaded(true);
  }, []);
  useEffect(() => {
    if (!savedLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // The built-in template library remains available if storage is full.
    }
  }, [saved, savedLoaded]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleLayers = useMemo(() => {
    const all = [...LAYER_TEMPLATES, ...saved];
    return all.filter((template) => {
      const categoryMatch =
        category === "全部" || category === "自定义"
          ? category !== "自定义" || template.id.startsWith("saved-")
          : template.category === (category as TemplateCategory);
      const textMatch = `${template.name} ${template.description} ${template.category}`
        .toLocaleLowerCase()
        .includes(normalizedSearch);
      return categoryMatch && textMatch;
    });
  }, [category, normalizedSearch, saved]);
  const visibleMotion = useMemo(() => {
    if (category !== "全部" && category !== "动效") return [];
    return MOTION_TEMPLATES.filter((template) => {
      const categoryMatch =
        category === "全部" || category === "动效" || template.category === category;
      return (
        categoryMatch &&
        `${template.name} ${template.description} ${template.category}`
          .toLocaleLowerCase()
          .includes(normalizedSearch)
      );
    });
  }, [category, normalizedSearch]);

  const saveSelectedAsTemplate = () => {
    if (!selectedLayer || selectedLayer.kind === "group") return;
    const name = templateName.trim() || selectedLayer.name;
    const next: SavedTemplate = {
      id: `saved-${nid("tpl")}`,
      name,
      category:
        selectedLayer.kind === "text" ? "文字" : selectedLayer.kind === "rect" ? "版式" : "图形",
      description: `来自图层「${selectedLayer.name}」的可复用外观`,
      kind:
        selectedLayer.kind === "image" || selectedLayer.kind === "path"
          ? "rect"
          : selectedLayer.kind,
      fill: selectedLayer.fill,
      fillEnabled: selectedLayer.fillEnabled,
      stroke: selectedLayer.stroke,
      strokeEnabled: selectedLayer.strokeEnabled,
      strokeWidth: selectedLayer.strokeWidth,
      cornerRadius: selectedLayer.cornerRadius ?? 8,
      widthRatio: Math.max(0.05, selectedLayer.w / projectWidth),
      heightRatio: Math.max(0.04, selectedLayer.h / projectHeight),
      position: "center",
      ...(selectedLayer.kind === "text" ? { text: selectedLayer.text } : {}),
      ...(selectedLayer.fontSize ? { fontSize: selectedLayer.fontSize } : {}),
      ...(selectedLayer.fontWeight ? { fontWeight: selectedLayer.fontWeight } : {}),
      ...(selectedLayer.fontFamily ? { fontFamily: selectedLayer.fontFamily } : {}),
      savedAt: Date.now(),
    };
    setSaved((current) => [next, ...current]);
    setTemplateName("");
    setSaving(false);
    setCategory("自定义");
  };

  const applySelectedMotion = (template: MotionTemplate) => {
    if (selectedId) applyMotionPreset(selectedId, template, duration, fps);
  };

  return (
    <div className="space-y-3 p-3">
      <div className="rounded-md border border-border bg-surface-2/45 p-2.5">
        <div className="flex items-start gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </span>
          <p className="text-[10px] leading-4 text-muted">
            创建标题、字幕、形状与版式，或将动效应用到当前选中图层。也可以保存当前外观供后续复用。
          </p>
        </div>
        {selectedLayer && selectedLayer.kind !== "group" && (
          <div className="mt-2 border-t border-border/70 pt-2">
            {saving ? (
              <div className="flex gap-1.5">
                <input
                  aria-label="自定义模板名称"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveSelectedAsTemplate();
                    if (event.key === "Escape") setSaving(false);
                  }}
                  placeholder={selectedLayer.name}
                  className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-[10px] text-fg outline-none focus:border-primary/60"
                />
                <button
                  type="button"
                  aria-label="保存模板"
                  onClick={saveSelectedAsTemplate}
                  className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-bg"
                >
                  <Check className="size-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSaving(true)}
                className="flex h-7 w-full items-center justify-center gap-1 rounded-md border border-border text-[10px] text-muted hover:bg-surface-2 hover:text-fg"
              >
                <Plus className="size-3" />
                保存「{selectedLayer.name}」外观为模板
              </button>
            )}
          </div>
        )}
      </div>

      <label className="relative flex h-8 items-center">
        <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted" />
        <input
          aria-label="搜索模板预设"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索模板与动效"
          className="h-full w-full rounded-md border border-border bg-bg pl-8 pr-2 text-[11px] text-fg outline-none placeholder:text-muted focus:border-primary/60"
        />
      </label>

      <div className="flex flex-wrap gap-1" aria-label="模板分类">
        {CATEGORIES.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={category === item}
            onClick={() => setCategory(item)}
            className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${category === item ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted hover:text-fg"}`}
          >
            {item}
          </button>
        ))}
      </div>

      <section className="space-y-2" aria-label="图层模板">
        {category !== "动效" && visibleLayers.length > 0 && (
          <>
            <h3 className="text-[10px] font-medium uppercase tracking-wide text-muted">
              可复用图层模板
            </h3>
            {visibleLayers.map((template) => (
              <LayerTemplateCard
                key={template.id}
                template={template}
                selectedLayer={selectedLayer}
                onAdd={() => applyLayerTemplate(template)}
                onApply={selectedLayer ? () => applyLayerStyle(template, selectedLayer) : undefined}
                onDelete={
                  template.id.startsWith("saved-")
                    ? () => setSaved((current) => current.filter((item) => item.id !== template.id))
                    : undefined
                }
              />
            ))}
          </>
        )}
        {visibleMotion.length > 0 && (
          <div className="space-y-2 pt-1">
            <h3 className="text-[10px] font-medium uppercase tracking-wide text-muted">动画预设</h3>
            {visibleMotion.map((template) => (
              <MotionTemplateCard
                key={template.id}
                template={template}
                disabled={!selectedId}
                onApply={() => applySelectedMotion(template)}
              />
            ))}
          </div>
        )}
        {visibleLayers.length === 0 && visibleMotion.length === 0 && (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-[10px] text-muted">
            没有匹配的模板。试试其他关键词或分类。
          </p>
        )}
      </section>
    </div>
  );
}
