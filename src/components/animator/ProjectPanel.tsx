import { useEffect, useRef, useState, type DragEvent } from "react";
import { FileImage, FolderOpen, Plus, Search, Trash2, Upload } from "lucide-react";
import {
  deleteProjectAsset,
  listProjectAssets,
  PROJECT_ASSET_DRAG_TYPE,
  saveProjectAsset,
  type ProjectAssetRecord,
} from "@/lib/animator/project-assets";

type ProjectAsset = ProjectAssetRecord & { previewUrl: string };

export function ProjectPanel({ onPlaceAsset }: { onPlaceAsset: (assetId: string) => void }) {
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef(new Set<string>());

  const withPreview = (asset: ProjectAssetRecord): ProjectAsset => {
    const previewUrl = URL.createObjectURL(asset.blob);
    previewUrls.current.add(previewUrl);
    return { ...asset, previewUrl };
  };

  useEffect(() => {
    let active = true;
    void listProjectAssets()
      .then((saved) => {
        if (active) setAssets(saved.slice().reverse().map(withPreview));
      })
      .catch(() => {
        if (active) setError("无法读取项目素材库");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      previewUrls.current.clear();
    };
  }, []);

  const importFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setImporting(true);
    setError("");
    const results = await Promise.allSettled(files.map(saveProjectAsset));
    const imported = results.flatMap((result) =>
      result.status === "fulfilled" ? [withPreview(result.value)] : [],
    );
    if (imported.length > 0) setAssets((current) => [...imported, ...current]);
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed > 0) setError(`${failed} 个文件无法导入，请选择图片或 SVG 文件。`);
    setImporting(false);
  };

  const removeAsset = async (asset: ProjectAsset) => {
    try {
      await deleteProjectAsset(asset.id);
      URL.revokeObjectURL(asset.previewUrl);
      previewUrls.current.delete(asset.previewUrl);
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      setSelectedId((current) => (current === asset.id ? null : current));
    } catch {
      setError("无法移除这个素材");
    }
  };

  const filteredAssets = assets.filter((asset) =>
    asset.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  const onDropFiles = (event: DragEvent<HTMLElement>) => {
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    void importFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <aside
      aria-label="项目文件"
      onDragOver={(event) => {
        if (event.dataTransfer.files.length > 0) event.preventDefault();
      }}
      onDrop={onDropFiles}
      className="flex h-40 w-full shrink-0 flex-col border-b border-border bg-surface md:h-full md:w-60 md:border-b-0 md:border-r"
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2 text-xs font-medium text-fg">
          <FolderOpen className="size-4 text-primary" />
          <span>项目</span>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
            {assets.length}
          </span>
        </div>
        <label
          className={`flex h-7 cursor-pointer items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted hover:border-primary/50 hover:bg-surface-2 hover:text-fg ${importing ? "pointer-events-none opacity-50" : ""}`}
          title="导入图片或 SVG 素材"
        >
          <Upload className="size-3.5" />
          {importing ? "导入中" : "导入素材"}
          <input
            ref={inputRef}
            type="file"
            accept="image/*,.svg"
            multiple
            aria-label="导入项目素材"
            className="hidden"
            onChange={(event) => {
              void importFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </label>
      </header>

      <label className="relative mx-2 mt-2 flex h-7 shrink-0 items-center">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-muted" />
        <input
          aria-label="搜索项目素材"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索素材"
          className="h-full w-full rounded-md border border-border bg-bg pl-7 pr-2 text-[11px] text-fg outline-none placeholder:text-muted focus:border-primary/60"
        />
      </label>

      {error && (
        <p role="alert" className="px-3 pt-1.5 text-[10px] text-danger">
          {error}
        </p>
      )}

      {filteredAssets.length > 0 ? (
        <div className="app-scrollbar flex min-h-0 flex-1 gap-1.5 overflow-x-auto p-2 md:flex-col md:overflow-x-hidden md:overflow-y-auto">
          {filteredAssets.map((asset) => (
            <div
              key={asset.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(PROJECT_ASSET_DRAG_TYPE, asset.id);
                event.dataTransfer.setData("text/plain", asset.id);
              }}
              className={`group flex h-12 w-44 shrink-0 items-center gap-2 rounded-md border px-1.5 transition-colors md:w-full ${selectedId === asset.id ? "border-primary/55 bg-primary/10" : "border-transparent hover:border-border hover:bg-surface-2"}`}
            >
              <button
                type="button"
                onClick={() => setSelectedId(asset.id)}
                onDoubleClick={() => onPlaceAsset(asset.id)}
                title="双击添加到画布，也可以拖到画布"
                className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded border border-border bg-bg">
                  <img src={asset.previewUrl} alt="" className="size-full object-contain" draggable={false} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[11px] font-medium text-fg">{asset.name}</span>
                  <span className="truncate font-mono text-[9px] text-muted">
                    {asset.mimeType === "image/svg+xml" ? "SVG" : asset.mimeType.split("/").at(-1)?.toUpperCase()} · {asset.width}×{asset.height}
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-label={`添加 ${asset.name} 到画布`}
                title="添加到画布"
                onClick={() => onPlaceAsset(asset.id)}
                className="grid size-7 shrink-0 place-items-center rounded text-muted hover:bg-primary/15 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Plus className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`移除 ${asset.name}`}
                title="从项目素材中移除"
                onClick={() => void removeAsset(asset)}
                className="grid size-7 shrink-0 place-items-center rounded text-muted opacity-70 hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-primary md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-2 text-center">
          <div className="flex items-center gap-3 md:flex-col">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-muted md:size-11">
              <FileImage className="size-5" />
            </span>
            <span className="text-left md:text-center">
              <span className="block text-[11px] font-medium text-fg">
                {loading ? "正在读取项目" : search ? "没有找到素材" : "素材栏为空"}
              </span>
              <span className="mt-0.5 block text-[10px] text-muted">
                {loading ? "" : "导入图片或 SVG，拖到画布或双击添加"}
              </span>
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
