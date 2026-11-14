const MAX_BYTES = 3_800_000; // editor image limit is 4 MB

/** Rasterize SVG text to a transparent PNG at `scale`×. */
export async function svgToPng(svg: string, scale = 4): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await fitPng(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Crop fully transparent margins. */
export function trimCanvas(source: HTMLCanvasElement, pad = 8): HTMLCanvasElement {
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return source;
  const { width, height } = source;
  const data = ctx.getImageData(0, 0, width, height).data;
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return source;
  left = Math.max(0, left - pad); top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad); bottom = Math.min(height - 1, bottom + pad);
  const out = document.createElement("canvas");
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext("2d")!.drawImage(source, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Encode as PNG, shrinking until it fits the editor's image budget. */
export async function fitPng(canvas: HTMLCanvasElement): Promise<Blob> {
  let current = canvas;
  for (let attempt = 0; attempt < 6; attempt++) {
    const blob = await new Promise<Blob | null>((resolve) => current.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The browser could not encode the image.");
    if (blob.size <= MAX_BYTES) return blob;
    const next = document.createElement("canvas");
    next.width = Math.round(current.width * 0.8);
    next.height = Math.round(current.height * 0.8);
    next.getContext("2d")!.drawImage(current, 0, 0, next.width, next.height);
    current = next;
  }
  throw new Error("The image is too large to insert. Choose a smaller size.");
}

export async function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  return canvas;
}
