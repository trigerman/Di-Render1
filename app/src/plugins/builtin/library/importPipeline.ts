/** Turns dropped files, folders and archives (.zip, .pptx, .tgz, .tar) into flat image entries. */
export interface Entry { path: string; file: Blob }

const IMAGE = /\.(svg|png|jpe?g)$/i;
const JUNK = /(^|\/)(__macosx|\._|\.ds_store)/i;

export const isArchive = (name: string) => /\.(zip|pptx|tgz|tar\.gz|tar)$/i.test(name);

async function gunzip(blob: Blob): Promise<Uint8Array> {
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function parseTar(bytes: Uint8Array): Entry[] {
  const out: Entry[] = [];
  const decoder = new TextDecoder();
  const str = (a: number, b: number) => { const s = decoder.decode(bytes.subarray(a, b)); const i = s.indexOf("\0"); return i >= 0 ? s.slice(0, i) : s; };
  let offset = 0;
  let longName: string | null = null;
  while (offset + 512 <= bytes.length) {
    const rawName = str(offset, offset + 100);
    if (!rawName) break;
    const size = parseInt(str(offset + 124, offset + 136).trim() || "0", 8) || 0;
    const type = String.fromCharCode(bytes[offset + 156] ?? 48);
    const ustar = str(offset + 257, offset + 262) === "ustar" && bytes[offset + 263] === 48;
    const prefix = ustar ? str(offset + 345, offset + 500) : "";
    const name = longName ?? (prefix ? `${prefix}/${rawName}` : rawName);
    longName = null;
    const start = offset + 512;
    if (type === "L") longName = str(start, start + size);
    else if (type === "x") { const m = /\d+ path=([^\n]+)\n/.exec(decoder.decode(bytes.subarray(start, start + size))); if (m) longName = m[1]!; }
    else if (type === "0" || type === "\0" || type === "7") out.push({ path: name, file: new Blob([bytes.slice(start, start + size)]) });
    offset = start + Math.ceil(size / 512) * 512;
  }
  return out;
}

export async function expandEntries(entries: Entry[], progress: (message: string) => void): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const entry of entries) {
    const lower = entry.path.toLowerCase();
    if (JUNK.test(entry.path)) continue;
    const base = entry.path.split("/").pop()!.replace(/\.(zip|pptx|tgz|tar\.gz|tar)$/i, "");
    if (/\.(zip|pptx)$/.test(lower)) {
      progress(`Opening ${entry.path.split("/").pop()}…`);
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(entry.file);
      for (const [name, item] of Object.entries(zip.files)) {
        if (item.dir || !IMAGE.test(name) || JUNK.test(name)) continue;
        if (lower.endsWith(".pptx") && !name.startsWith("ppt/media/")) continue;
        out.push({ path: lower.endsWith(".pptx") ? `${base}/${name.split("/").pop()}` : `${base}/${name}`, file: await item.async("blob") });
      }
    } else if (/\.(tgz|tar\.gz|tar)$/.test(lower)) {
      progress(`Unpacking ${entry.path.split("/").pop()}…`);
      const bytes = lower.endsWith(".tar") ? new Uint8Array(await entry.file.arrayBuffer()) : await gunzip(entry.file);
      for (const item of parseTar(bytes)) if (IMAGE.test(item.path) && !JUNK.test(item.path)) out.push(item);
    } else if (IMAGE.test(lower)) out.push(entry);
  }
  return out;
}

/** Read files and folders from a drop event (folders recurse). */
export async function entriesFromDrop(transfer: DataTransfer): Promise<Entry[]> {
  // Capture the entries synchronously: DataTransfer items expire after the first await.
  const roots = [...transfer.items].map((item) => item.webkitGetAsEntry?.() ?? null).filter((x): x is FileSystemEntry => !!x);
  if (!roots.length) return [...transfer.files].map((file) => ({ path: file.name, file }));
  const out: Entry[] = [];
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ path: path + file.name, file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        for (const child of batch) await walk(child, `${path}${entry.name}/`);
      } while (batch.length);
    }
  };
  for (const root of roots) await walk(root, "");
  return out;
}

const LICENSE_FOLDER = /^(cc[-_ ]?0|cc[-_ ]?by(?:[-_ ]?sa)?[-_ ]?[34]\.0|mit|bsd|public[-_ ]?domain)$/i;
const GENERIC = /^(svg|png|icons?|static|images?|media|img|files?|icon-lib(-svg|-png)?|dist|assets|.*-main|.*-master)$/i;

/** Name, category, licence and author from a path. Understands the Bioicons folder layout (licence/category/author/file). */
export function deriveMeta(path: string) {
  const parts = path.split("/").filter(Boolean);
  const file = parts.pop() ?? "icon";
  const name = file.replace(/\.[^.]+$/, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim() || "Icon";
  let category = "";
  let licenseFolder = "";
  let author = "";
  const index = parts.findIndex((p) => LICENSE_FOLDER.test(p));
  if (index >= 0) {
    licenseFolder = parts[index]!.toLowerCase().replace(/[_ ]/g, "-");
    category = parts[index + 1] ?? "";
    author = (parts[index + 2] ?? "").replace(/[_-]+/g, " ").trim();
  }
  if (!category) category = [...parts].reverse().find((p) => !GENERIC.test(p)) ?? "";
  category = (category || "Imported").replace(/[_-]+/g, " ").trim();
  category = category.charAt(0).toUpperCase() + category.slice(1);
  return { name, category, licenseFolder, author };
}
