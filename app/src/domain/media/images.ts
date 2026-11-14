import { InputError, INPUT_LIMITS, assertFileSize } from "../security/input";

export type ImageMime = "image/png" | "image/jpeg";
export interface ProjectImage {
  id: string;
  name: string;
  mimeType: ImageMime;
  data: string;
  width: number;
  height: number;
}

const read32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset]! * 0x1000000) + (bytes[offset+1]! << 16) + (bytes[offset+2]! << 8) + bytes[offset+3]!) >>> 0;

export function inspectImage(bytes: Uint8Array): { mimeType: ImageMime; width: number; height: number } {
  let mimeType: ImageMime;
  let width: number;
  let height: number;
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte)) {
    mimeType = "image/png";
    width = read32(bytes, 16);
    height = read32(bytes, 20);
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    mimeType = "image/jpeg";
    width = 0; height = 0;
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset+1]!;
      if (marker === 0xD9 || marker === 0xDA) break;
      if (marker === 0xFF) { offset++; continue; }
      const segmentLength = bytes[offset+2]! * 256 + bytes[offset+3]!;
      if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
      if ([0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF].includes(marker)) {
        height = bytes[offset+5]! * 256 + bytes[offset+6]!;
        width = bytes[offset+7]! * 256 + bytes[offset+8]!;
        break;
      }
      offset += 2 + segmentLength;
    }
  } else throw new InputError("unsupported_image", "Choose a PNG or JPEG image.");
  if (!width || !height || width > INPUT_LIMITS.pngSide || height > INPUT_LIMITS.pngSide || width * height > INPUT_LIMITS.imagePixels)
    throw new InputError("image_dimensions", "Image dimensions exceed the supported limit.");
  return { mimeType, width, height };
}

export function decodeProjectImage(image: ProjectImage): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data) || image.data.length % 4 !== 0 || image.data.length > Math.ceil(INPUT_LIMITS.imageBytes / 3) * 4)
    throw new InputError("invalid_image", "Image data is invalid or too large.");
  let binary: string;
  try { binary = atob(image.data); }
  catch { throw new InputError("invalid_image", "Image data is invalid."); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  assertFileSize(bytes.length, INPUT_LIMITS.imageBytes);
  const actual = inspectImage(bytes);
  if (actual.mimeType !== image.mimeType || actual.width !== image.width || actual.height !== image.height)
    throw new InputError("invalid_image", "Image data does not match its metadata.");
  return bytes;
}

export const imageDataUrl = (image: ProjectImage) => `data:${image.mimeType};base64,${image.data}`;

export async function prepareImageFile(file: File): Promise<ProjectImage> {
  assertFileSize(file.size, INPUT_LIMITS.imageBytes);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = inspectImage(bytes);
  // The decoder must accept the entire file, not just its header.
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([bytes], { type: dimensions.mimeType })); }
  catch { throw new InputError("invalid_image", "The image could not be decoded."); }
  const matches = bitmap.width === dimensions.width && bitmap.height === dimensions.height;
  bitmap.close();
  if (!matches) throw new InputError("invalid_image", "Image dimensions are inconsistent.");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192)
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return {
    id: `image-${digest}`, name: file.name.slice(0, 256) || "Local image",
    ...dimensions, data: btoa(binary),
  };
}
