import { useEffect, useState } from "react";
import { Layers3, SlidersHorizontal, X } from "lucide-react";
import { useDoc } from "@/lib/animator/store";
import { Inspector } from "./Inspector.tsx";
import { TemplatePanel } from "./TemplatePanel.tsx";

type PanelTab = "properties" | "templates";

function PanelTabs({
  tab,
  onChange,
  compact = false,
}: {
  tab: PanelTab;
  onChange: (tab: PanelTab) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1 ${compact ? "flex-1" : "border-b border-border/75 px-2 pt-2"}`}
    >
      <button
        type="button"
        aria-pressed={tab === "properties"}
        onClick={() => onChange("properties")}
        className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-t-md border-b-2 px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${tab === "properties" ? "border-primary bg-primary/5 text-primary" : "border-transparent text-muted hover:bg-surface-2/60 hover:text-fg"}`}
      >
        <SlidersHorizontal className="size-3.5" />
        属性
      </button>
      <button
        type="button"
        aria-pressed={tab === "templates"}
        onClick={() => onChange("templates")}
        className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-t-md border-b-2 px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${tab === "templates" ? "border-primary bg-primary/5 text-primary" : "border-transparent text-muted hover:bg-surface-2/60 hover:text-fg"}`}
      >
        <Layers3 className="size-3.5" />
        模板
      </button>
    </div>
  );
}

function PanelBody({ tab }: { tab: PanelTab }) {
  return tab === "properties" ? <Inspector /> : <TemplatePanel />;
}

export function RightPanel() {
  const selectedId = useDoc((state) => state.selectedId);
  const [tab, setTab] = useState<PanelTab>("properties");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (selectedId) {
      setTab("properties");
      setMobileOpen(isMobile);
    } else {
      setMobileOpen(false);
    }
  }, [isMobile, selectedId]);

  return (
    <>
      <aside
        aria-label="属性与模板面板"
        className="right-panel-desktop app-scrollbar min-h-0 w-72 shrink-0 flex-col border-l border-border bg-surface/95"
      >
        <PanelTabs tab={tab} onChange={setTab} />
        <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto">
          {!isMobile && <PanelBody tab={tab} />}
        </div>
      </aside>

      <div className="right-panel-mobile">
        {mobileOpen ? (
          <section className="flex max-h-[52vh] w-[min(90vw,360px)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
            <header className="flex items-center gap-1 border-b border-border p-1.5">
              <PanelTabs tab={tab} onChange={setTab} compact />
              <button
                type="button"
                aria-label="关闭属性面板"
                onClick={() => setMobileOpen(false)}
                className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="app-scrollbar min-h-0 overflow-y-auto">
              {isMobile && <PanelBody tab={tab} />}
            </div>
          </section>
        ) : (
          <div className="flex gap-1 rounded-lg border border-border bg-surface/95 p-1 shadow-xl backdrop-blur">
            <button
              type="button"
              onClick={() => {
                setTab("properties");
                setMobileOpen(true);
              }}
              className="flex h-8 items-center gap-1 rounded-md px-2.5 text-[11px] text-fg hover:bg-primary/10 hover:text-primary"
            >
              <SlidersHorizontal className="size-3.5" /> 属性
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("templates");
                setMobileOpen(true);
              }}
              className="flex h-8 items-center gap-1 rounded-md px-2.5 text-[11px] text-fg hover:bg-primary/10 hover:text-primary"
            >
              <Layers3 className="size-3.5" /> 模板
            </button>
          </div>
        )}
      </div>
    </>
  );
}
