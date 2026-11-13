import type { PropKey, ShapeKind, Interp } from "./model";

export type TemplateCategory = "标题" | "文字" | "图形" | "版式";
export type TemplatePosition = "center" | "upper" | "lower" | "lower-left" | "full";

export type LayerTemplate = {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  kind: Exclude<ShapeKind, "image" | "path" | "group">;
  fill: string;
  fillEnabled?: boolean;
  stroke: string;
  strokeEnabled?: boolean;
  strokeWidth: number;
  cornerRadius: number;
  widthRatio: number;
  heightRatio: number;
  position: TemplatePosition;
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  motionId?: string;
};

export type MotionFrame = {
  at: number;
  value: number | string;
  interp?: Interp;
};

export type MotionTrack = { prop: PropKey; frames: MotionFrame[] };

export type MotionTemplate = {
  id: string;
  name: string;
  category: "入场" | "强调" | "循环" | "颜色";
  description: string;
  tracks: MotionTrack[];
};

export const LAYER_TEMPLATES: LayerTemplate[] = [
  {
    id: "hero-title",
    name: "主标题",
    category: "标题",
    description: "居中大字，淡入上浮",
    kind: "text",
    text: "主标题文案",
    fill: "#f5f7fb",
    stroke: "#f5f7fb",
    strokeWidth: 0,
    cornerRadius: 0,
    fontSize: 78,
    fontWeight: 800,
    widthRatio: 0.82,
    heightRatio: 0.18,
    position: "center",
    motionId: "fade-up",
  },
  {
    id: "section-title",
    name: "章节标题",
    category: "标题",
    description: "品牌蓝标题，适合开场与章节页",
    kind: "text",
    text: "章节标题",
    fill: "#4c9fff",
    stroke: "#4c9fff",
    strokeWidth: 0,
    cornerRadius: 0,
    fontSize: 64,
    fontWeight: 700,
    widthRatio: 0.8,
    heightRatio: 0.16,
    position: "center",
    motionId: "pop-in",
  },
  {
    id: "subtitle",
    name: "副标题",
    category: "文字",
    description: "轻量说明文字，放在主标题下方",
    kind: "text",
    text: "补充说明与副标题",
    fill: "#c8d2e0",
    stroke: "#c8d2e0",
    strokeWidth: 0,
    cornerRadius: 0,
    fontSize: 34,
    fontWeight: 400,
    widthRatio: 0.76,
    heightRatio: 0.1,
    position: "lower",
    motionId: "fade-in",
  },
  {
    id: "eyebrow",
    name: "眉题 / Kicker",
    category: "文字",
    description: "短标签式小标题，适合品牌或栏目名",
    kind: "text",
    text: "BRAND · STUDIO",
    fill: "#80bdff",
    stroke: "#80bdff",
    strokeWidth: 0,
    cornerRadius: 0,
    fontSize: 22,
    fontWeight: 700,
    widthRatio: 0.58,
    heightRatio: 0.08,
    position: "upper",
    motionId: "slide-left",
  },
  {
    id: "lower-third",
    name: "下三分之一",
    category: "版式",
    description: "左下字幕标题，适合人物介绍与信息条",
    kind: "text",
    text: "姓名 / 职位 / 地点",
    fill: "#f5f7fb",
    stroke: "#f5f7fb",
    strokeWidth: 0,
    cornerRadius: 0,
    fontSize: 36,
    fontWeight: 600,
    widthRatio: 0.74,
    heightRatio: 0.11,
    position: "lower-left",
    motionId: "slide-left",
  },
  {
    id: "caption",
    name: "字幕行",
    category: "文字",
    description: "适合短视频口播和说明字幕",
    kind: "text",
    text: "这里输入一行字幕内容",
    fill: "#ffffff",
    stroke: "#111827",
    strokeWidth: 0,
    cornerRadius: 0,
    fontSize: 30,
    fontWeight: 600,
    widthRatio: 0.88,
    heightRatio: 0.09,
    position: "lower",
    motionId: "fade-up",
  },
  {
    id: "pill-tag",
    name: "胶囊标签",
    category: "图形",
    description: "圆角标签底板，可搭配文字图层",
    kind: "rect",
    fill: "#213a58",
    stroke: "#4c9fff",
    strokeWidth: 2,
    cornerRadius: 64,
    widthRatio: 0.24,
    heightRatio: 0.09,
    position: "upper",
    motionId: "pop-in",
  },
  {
    id: "primary-button",
    name: "行动按钮",
    category: "图形",
    description: "品牌蓝按钮底板，适合 CTA 与片尾",
    kind: "rect",
    fill: "#4c9fff",
    stroke: "#a9d1ff",
    strokeWidth: 2,
    cornerRadius: 28,
    widthRatio: 0.26,
    heightRatio: 0.1,
    position: "lower",
    motionId: "pulse",
  },
  {
    id: "glass-card",
    name: "信息卡片",
    category: "版式",
    description: "深色圆角卡片，适合标题与多行说明组合",
    kind: "rect",
    fill: "#1d2b3b",
    stroke: "#49627d",
    strokeWidth: 2,
    cornerRadius: 32,
    widthRatio: 0.72,
    heightRatio: 0.36,
    position: "center",
    motionId: "fade-up",
  },
  {
    id: "full-backdrop",
    name: "全屏背景",
    category: "版式",
    description: "铺满项目画布的深色背景层",
    kind: "rect",
    fill: "#121a25",
    stroke: "#121a25",
    strokeWidth: 0,
    cornerRadius: 0,
    widthRatio: 1,
    heightRatio: 1,
    position: "full",
    motionId: "fade-in",
  },
  {
    id: "orbit-ring",
    name: "椭圆光环",
    category: "图形",
    description: "描边椭圆，可作为轨道或聚焦装饰",
    kind: "ellipse",
    fill: "none",
    stroke: "#4c9fff",
    strokeWidth: 5,
    cornerRadius: 0,
    widthRatio: 0.72,
    heightRatio: 0.38,
    position: "center",
    motionId: "rotate-in",
  },
  {
    id: "star-badge",
    name: "星形徽章",
    category: "图形",
    description: "金色强调图形，适合活动与重点标记",
    kind: "star",
    fill: "#ffc94a",
    stroke: "#fff0b5",
    strokeWidth: 3,
    cornerRadius: 0,
    widthRatio: 0.14,
    heightRatio: 0.22,
    position: "upper",
    motionId: "pop-in",
  },
  {
    id: "gold-divider",
    name: "金色分隔线",
    category: "图形",
    description: "简洁的横向章节分隔与强调线",
    kind: "rect",
    fill: "#ffc94a",
    stroke: "#ffc94a",
    strokeWidth: 0,
    cornerRadius: 4,
    widthRatio: 0.48,
    heightRatio: 0.012,
    position: "lower",
    motionId: "slide-left",
  },
];

export const MOTION_TEMPLATES: MotionTemplate[] = [
  {
    id: "fade-up",
    name: "淡入上浮",
    category: "入场",
    description: "透明度渐显，并从下方滑入",
    tracks: [
      {
        prop: "opacity",
        frames: [
          { at: 0, value: 0 },
          { at: 0.2, value: 1 },
        ],
      },
      {
        prop: "y",
        frames: [
          { at: 0, value: 84 },
          { at: 0.2, value: 0 },
        ],
      },
    ],
  },
  {
    id: "fade-in",
    name: "柔和淡入",
    category: "入场",
    description: "透明度从 0 平滑进入",
    tracks: [
      {
        prop: "opacity",
        frames: [
          { at: 0, value: 0 },
          { at: 0.24, value: 1 },
        ],
      },
    ],
  },
  {
    id: "slide-left",
    name: "横向滑入",
    category: "入场",
    description: "从右向左进入当前位置",
    tracks: [
      {
        prop: "opacity",
        frames: [
          { at: 0, value: 0 },
          { at: 0.18, value: 1 },
        ],
      },
      {
        prop: "x",
        frames: [
          { at: 0, value: 110 },
          { at: 0.18, value: 0 },
        ],
      },
    ],
  },
  {
    id: "pop-in",
    name: "弹性弹入",
    category: "入场",
    description: "缩小进入并带轻微回弹",
    tracks: [
      {
        prop: "opacity",
        frames: [
          { at: 0, value: 0 },
          { at: 0.12, value: 1 },
        ],
      },
      {
        prop: "scale",
        frames: [
          { at: 0, value: 0.7 },
          { at: 0.12, value: 1.08 },
          { at: 0.24, value: 1 },
        ],
      },
      {
        prop: "scaleY",
        frames: [
          { at: 0, value: 0.7 },
          { at: 0.12, value: 1.08 },
          { at: 0.24, value: 1 },
        ],
      },
    ],
  },
  {
    id: "rotate-in",
    name: "旋转落位",
    category: "入场",
    description: "带角度淡入并回到正向",
    tracks: [
      {
        prop: "opacity",
        frames: [
          { at: 0, value: 0 },
          { at: 0.2, value: 1 },
        ],
      },
      {
        prop: "rotate",
        frames: [
          { at: 0, value: -16 },
          { at: 0.2, value: 0 },
        ],
      },
    ],
  },
  {
    id: "pulse",
    name: "循环呼吸",
    category: "循环",
    description: "全片轻微放大再回落，配合循环播放",
    tracks: [
      {
        prop: "scale",
        frames: [
          { at: 0, value: 1 },
          { at: 0.5, value: 1.08 },
          { at: 1, value: 1 },
        ],
      },
      {
        prop: "scaleY",
        frames: [
          { at: 0, value: 1 },
          { at: 0.5, value: 1.08 },
          { at: 1, value: 1 },
        ],
      },
    ],
  },
  {
    id: "sway",
    name: "摆动强调",
    category: "强调",
    description: "短促摆动后回正",
    tracks: [
      {
        prop: "rotate",
        frames: [
          { at: 0, value: 0 },
          { at: 0.18, value: -7 },
          { at: 0.36, value: 7 },
          { at: 0.56, value: -3 },
          { at: 0.72, value: 0 },
        ],
      },
    ],
  },
  {
    id: "color-shift",
    name: "品牌变色",
    category: "颜色",
    description: "蓝紫金三色流转并回到品牌蓝",
    tracks: [
      {
        prop: "fill",
        frames: [
          { at: 0, value: "#4c9fff" },
          { at: 0.34, value: "#9b79ff" },
          { at: 0.67, value: "#ffc94a" },
          { at: 1, value: "#4c9fff" },
        ],
      },
    ],
  },
];

export function motionTemplateById(id?: string): MotionTemplate | undefined {
  return id ? MOTION_TEMPLATES.find((template) => template.id === id) : undefined;
}
