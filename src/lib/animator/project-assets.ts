import type { PersistedDoc } from "./model";

export type ProjectAssetRecord = {
  id: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;
  blob: Blob;
};

const DATABASE_NAME = "kairo-project-assets";
const DATABASE_VERSION = 2;
const STORE_NAME = "assets";
const DOCUMENT_STORE_NAME = "documents";
const DOCUMENT_RECORD_ID = "current";
export const PROJECT_ASSET_DRAG_TYPE = "application/x-kairo-project-asset";
export const PROJECT_ASSETS_CHANGED_EVENT = "kairo-project-assets-changed";

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(DOCUMENT_STORE_NAME)) {
        database.createObjectStore(DOCUMENT_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("无法打开项目素材库"));
    };
  });
  return databasePromise;
}

async function requestResult<T>(
  mode: IDBTransactionMode,
  requestForStore: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = requestForStore(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("读取项目素材失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("项目素材操作失败"));
  });
}

function isSvg(file: File): boolean {
  return file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
}

function svgDimensions(text: string): { width: number; height: number } {
  const documentNode = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = documentNode.documentElement;
  if (root.tagName.toLowerCase() !== "svg" || documentNode.querySelector("parsererror")) {
    throw new Error("SVG 文件格式无效");
  }
  const viewBox = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const viewWidth = viewBox.length === 4 && Number.isFinite(viewBox[2]) ? viewBox[2] : 800;
  const viewHeight = viewBox.length === 4 && Number.isFinite(viewBox[3]) ? viewBox[3] : 500;
  const parseSize = (value: string | null, fallback: number) => {
    if (!value || value.trim().endsWith("%")) return fallback;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    width: parseSize(root.getAttribute("width"), viewWidth),
    height: parseSize(root.getAttribute("height"), viewHeight),
  };
}

function fallbackImageType(file: File): string {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "avif") return "image/avif";
  return file.type || "application/octet-stream";
}

export async function saveProjectAsset(file: File): Promise<ProjectAssetRecord> {
  const name = file.name.trim() || "未命名素材";
  let blob: Blob = file;
  const mimeType = isSvg(file) ? "image/svg+xml" : fallbackImageType(file);
  let width = 0;
  let height = 0;

  if (isSvg(file)) {
    const text = await file.text();
    ({ width, height } = svgDimensions(text));
    blob = new Blob([text], { type: mimeType });
  } else if (mimeType.startsWith("image/")) {
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  } else {
    throw new Error("目前支持图片和 SVG 文件");
  }

  const record: ProjectAssetRecord = {
    id: crypto.randomUUID(),
    name,
    mimeType,
    width,
    height,
    size: file.size,
    blob,
  };
  await requestResult("readwrite", (store) => store.put(record));
  return record;
}

export function listProjectAssets(): Promise<ProjectAssetRecord[]> {
  return requestResult("readonly", (store) => store.getAll());
}

export async function replaceProjectAssets(assets: ProjectAssetRecord[]): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    for (const asset of assets) store.put(asset);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("写入项目素材失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("项目素材导入已取消"));
  });
}

type DocumentSnapshotRecord = {
  id: typeof DOCUMENT_RECORD_ID;
  current: PersistedDoc;
  backup?: PersistedDoc;
  savedAt: number;
};

export async function saveDocumentSnapshot(document: PersistedDoc): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DOCUMENT_STORE_NAME, "readwrite");
    const store = transaction.objectStore(DOCUMENT_STORE_NAME);
    const request = store.get(DOCUMENT_RECORD_ID);
    request.onsuccess = () => {
      const previous = request.result as DocumentSnapshotRecord | undefined;
      store.put({
        id: DOCUMENT_RECORD_ID,
        current: document,
        backup: previous?.current ?? previous?.backup,
        savedAt: Date.now(),
      } satisfies DocumentSnapshotRecord);
    };
    request.onerror = () => transaction.abort();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("保存恢复副本失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("保存恢复副本失败"));
  });
}

export async function loadDocumentSnapshot(): Promise<{
  current?: PersistedDoc;
  backup?: PersistedDoc;
} | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DOCUMENT_STORE_NAME, "readonly");
    const request = transaction.objectStore(DOCUMENT_STORE_NAME).get(DOCUMENT_RECORD_ID);
    request.onsuccess = () => {
      const record = request.result as DocumentSnapshotRecord | undefined;
      resolve(record ? { current: record.current, backup: record.backup } : null);
    };
    request.onerror = () => reject(request.error ?? new Error("读取恢复副本失败"));
  });
}

export function getProjectAsset(id: string): Promise<ProjectAssetRecord | undefined> {
  return requestResult("readonly", (store) => store.get(id));
}

export async function deleteProjectAsset(id: string): Promise<void> {
  await requestResult("readwrite", (store) => store.delete(id));
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("素材读取失败"));
    reader.onerror = () => reject(reader.error ?? new Error("素材读取失败"));
    reader.readAsDataURL(blob);
  });
}

export async function projectAssetImageSource(asset: ProjectAssetRecord): Promise<string> {
  let blob = asset.blob;
  if (asset.mimeType === "image/svg+xml") return readAsDataUrl(blob);

  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    if (scale < 1 || blob.size > 2 * 1024 * 1024) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const optimized = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/webp", 0.9),
        );
        if (optimized && (optimized.size < blob.size || scale < 1)) blob = optimized;
      }
    }
  } finally {
    bitmap.close();
  }
  return readAsDataUrl(blob);
}
