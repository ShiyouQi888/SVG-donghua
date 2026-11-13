import type { PersistedDoc } from "./model";
import type { ProjectAssetRecord } from "./project-assets";

export const KAIRO_PROJECT_FORMAT = "kairo-project";
export const KAIRO_PROJECT_VERSION = 1;

export type ArchivedProjectAsset = Omit<ProjectAssetRecord, "blob"> & { dataUrl: string };
export type KairoProjectFile = {
  format: typeof KAIRO_PROJECT_FORMAT;
  version: typeof KAIRO_PROJECT_VERSION;
  createdAt: string;
  document: PersistedDoc;
  assets: ArchivedProjectAsset[];
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("素材编码失败"));
    reader.onerror = () => reject(reader.error ?? new Error("读取项目素材失败"));
    reader.readAsDataURL(blob);
  });
}

export async function createKairoProjectFile(
  document: PersistedDoc,
  assets: ProjectAssetRecord[],
): Promise<KairoProjectFile> {
  return {
    format: KAIRO_PROJECT_FORMAT,
    version: KAIRO_PROJECT_VERSION,
    createdAt: new Date().toISOString(),
    document,
    assets: await Promise.all(
      assets.map(async ({ blob, ...asset }) => ({ ...asset, dataUrl: await blobToDataUrl(blob) })),
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeAsset(value: unknown): Promise<ProjectAssetRecord> {
  if (!isRecord(value)) throw new Error("项目素材条目格式无效");
  const { id, name, mimeType, width, height, size, dataUrl } = value;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof mimeType !== "string" ||
    !mimeType.startsWith("image/") ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    typeof size !== "number" ||
    typeof dataUrl !== "string" ||
    !dataUrl.startsWith(`data:${mimeType}`)
  ) {
    throw new Error("项目中包含无效的图片素材");
  }
  return fetch(dataUrl).then(async (response) => ({
    id,
    name,
    mimeType,
    width,
    height,
    size,
    blob: await response.blob(),
  }));
}

export async function parseKairoProjectFile(file: File): Promise<{
  document: PersistedDoc;
  assets: ProjectAssetRecord[];
}> {
  if (file.size > 250 * 1024 * 1024) throw new Error("项目文件超过 250 MB，无法在浏览器中打开");

  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("项目文件不是有效的 JSON 格式");
  }
  if (!isRecord(parsed) || parsed.format !== KAIRO_PROJECT_FORMAT) {
    throw new Error("这不是金帧项目文件");
  }
  if (parsed.version !== KAIRO_PROJECT_VERSION) {
    throw new Error(`无法打开项目版本 ${String(parsed.version)}；当前支持版本 ${KAIRO_PROJECT_VERSION}`);
  }
  if (
    !isRecord(parsed.document) ||
    typeof parsed.document.duration !== "number" ||
    !Array.isArray(parsed.document.layers) ||
    !Array.isArray(parsed.assets)
  ) {
    throw new Error("项目文件缺少动画文档或素材数据");
  }

  return {
    document: parsed.document as unknown as PersistedDoc,
    assets: await Promise.all(parsed.assets.map(decodeAsset)),
  };
}
