import { ChevronLeft, ChevronRight, Timer } from "lucide-react";
import { type PropKey, keyNear } from "@/lib/animator/model";
import { useDoc } from "@/lib/animator/store";

export function KeyNav({
  layerId,
  prop,
  compact = false,
}: {
  layerId: string;
  prop: PropKey;
  compact?: boolean;
}) {
  const time = useDoc((s) => s.time);
  const armed = useDoc((s) => s.layers.find((l) => l.id === layerId)?.armed[prop] ?? false);
  const has = useDoc((s) => {
    const layer = s.layers.find((l) => l.id === layerId);
    return layer ? Boolean(keyNear(layer.tracks[prop], s.time, s.fps)) : false;
  });
  const toggleArm = useDoc((s) => s.toggleArm);
  const toggleKey = useDoc((s) => s.toggleKey);
  const stepProp = useDoc((s) => s.stepProp);
  const buttonSize = compact ? "size-6" : "size-7";

  return (
    <div className={`flex items-center ${compact ? "gap-0" : "gap-0.5"}`}>
      <button
        type="button"
        title={armed ? "关闭秒表，清除该属性关键帧" : "打开秒表，从当前时间开始记录"}
        aria-pressed={armed}
        onClick={() => toggleArm(layerId, prop)}
        className={`grid ${buttonSize} place-items-center rounded-md border border-transparent ${armed ? "text-key" : "text-muted hover:text-fg"}`}
      >
        <Timer className={compact ? "size-3" : "size-3.5"} strokeWidth={2} />
      </button>
      <button
        type="button"
        title="上一关键帧"
        aria-label="上一关键帧"
        onClick={() => stepProp(layerId, prop, -1)}
        className={`grid ${buttonSize} place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg`}
      >
        <ChevronLeft className={compact ? "size-3" : "size-3.5"} />
      </button>
      <button
        type="button"
        title={has ? "删除当前时间的关键帧" : "在播放头打 K 帧"}
        aria-label={has ? "删除关键帧" : "添加关键帧"}
        aria-pressed={has}
        onClick={() => toggleKey(layerId, prop)}
        className={`grid ${buttonSize} place-items-center rounded-md hover:bg-surface-2`}
      >
        <span className={`k-diamond ${has ? "is-on" : ""}`} data-time={time} />
      </button>
      <button
        type="button"
        title="下一关键帧"
        aria-label="下一关键帧"
        onClick={() => stepProp(layerId, prop, 1)}
        className={`grid ${buttonSize} place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg`}
      >
        <ChevronRight className={compact ? "size-3" : "size-3.5"} />
      </button>
    </div>
  );
}
