import {
  buildFrameExport,
  type ExportDimensions,
  type Layer,
  type MotionBlurSettings,
} from "./model";

export type MediaExportOptions = {
  layers: Layer[];
  duration: number;
  fps: number;
  dimensions: ExportDimensions;
  motionBlur: MotionBlurSettings;
  transparentBackground: boolean;
  frameTime?: number;
  onProgress?: (progress: number) => void;
};

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function renderFrame(
  context: CanvasRenderingContext2D,
  time: number,
  options: MediaExportOptions,
): Promise<void> {
  const svg = buildFrameExport(
    options.layers,
    time,
    options.duration,
    options.dimensions,
    options.motionBlur,
    options.transparentBackground,
    options.fps,
  );
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.drawImage(image, 0, 0, context.canvas.width, context.canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export async function exportPng(options: MediaExportOptions): Promise<Blob> {
  const canvas = makeCanvas(options.dimensions.exportWidth, options.dimensions.exportHeight);
  const context = canvas.getContext("2d", { alpha: options.transparentBackground });
  if (!context) throw new Error("浏览器无法创建画布。");
  await renderFrame(context, options.frameTime ?? 0, options);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG 编码失败。"))),
      "image/png",
    );
  });
}

export async function exportGif(options: MediaExportOptions): Promise<Blob> {
  const { applyPalette, GIFEncoder, quantize } = await import("gifenc");
  const width = options.dimensions.exportWidth;
  const height = options.dimensions.exportHeight;
  const fps = options.fps;
  const totalFrames = Math.max(1, Math.ceil(options.duration * fps));
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: options.transparentBackground });
  if (!context) throw new Error("浏览器无法创建画布。");
  const encoder = GIFEncoder();
  const format = options.transparentBackground ? "rgba4444" : "rgb565";

  for (let frame = 0; frame < totalFrames; frame++) {
    const time = Math.min(options.duration, frame / fps);
    await renderFrame(context, time, options);
    const pixels = context.getImageData(0, 0, width, height).data;
    const palette = quantize(pixels, 256, {
      format,
      ...(options.transparentBackground ? { oneBitAlpha: true } : {}),
    });
    const transparentIndex = options.transparentBackground
      ? palette.findIndex((color) => color.length > 3 && color[3] === 0)
      : -1;
    const indexed = applyPalette(pixels, palette, format);
    encoder.writeFrame(indexed, width, height, {
      palette,
      delay: Math.round(1000 / fps),
      repeat: 0,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
    });
    options.onProgress?.((frame + 1) / totalFrames);
    await yieldToBrowser();
  }

  encoder.finish();
  return new Blob([new Uint8Array(encoder.bytes()).buffer as ArrayBuffer], { type: "image/gif" });
}

export async function exportWebm(options: MediaExportOptions): Promise<Blob> {
  if (typeof MediaRecorder === "undefined") throw new Error("当前浏览器不支持视频录制。");
  const mimeType = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) throw new Error("当前浏览器没有可用的 WebM 编码器。");

  const canvas = makeCanvas(options.dimensions.exportWidth, options.dimensions.exportHeight);
  const context = canvas.getContext("2d", { alpha: options.transparentBackground });
  if (!context || typeof canvas.captureStream !== "function") {
    throw new Error("当前浏览器不支持画布视频录制。");
  }
  const fps = options.fps;
  const totalFrames = Math.max(1, Math.ceil(options.duration * fps));
  await renderFrame(context, 0, options);
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => resolve(), { once: true });
    recorder.addEventListener(
      "error",
      () => reject(new Error("视频编码失败。")),
      { once: true },
    );
  });
  recorder.start(250);
  const frameDelay = 1000 / fps;
  try {
    for (let frame = 1; frame < totalFrames; frame++) {
      await new Promise((resolve) => window.setTimeout(resolve, frameDelay));
      await renderFrame(context, frame / fps, options);
      options.onProgress?.((frame + 1) / totalFrames);
    }
    await new Promise((resolve) => window.setTimeout(resolve, frameDelay));
    recorder.stop();
    await stopped;
  } catch (error) {
    if (recorder.state !== "inactive") recorder.stop();
    await stopped.catch(() => undefined);
    throw error;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
  return new Blob(chunks, { type: recorder.mimeType || mimeType });
}

