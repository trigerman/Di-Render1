import { createStore, del, delMany, get, getMany, set, setMany } from "idb-keyval";
import type { PluginLicense } from "../../types";

/** Metadata kept in one index record; artwork bytes are stored per item. */
export interface LibraryItem {
  id: string;
  name: string;
  category: string;
  provider: string;
  author: string;
  license?: PluginLicense;
  attribution: string;
  kind: "svg" | "image";
  added: string;
}
export type Payload = string | Blob; // sanitized SVG text, or PNG/JPEG blob

const store = createStore("di-render-library", "items");
const INDEX = "index";

export async function loadIndex(): Promise<LibraryItem[]> {
  try { return ((await get<LibraryItem[]>(INDEX, store)) ?? []); } catch { return []; }
}
export async function saveItems(index: LibraryItem[], added: Array<[LibraryItem, Payload]>) {
  await setMany(added.map(([item, payload]) => [`item:${item.id}`, payload] as [IDBValidKey, unknown]), store);
  await set(INDEX, index, store);
}
export async function loadPayloads(ids: string[]): Promise<Array<Payload | undefined>> {
  return getMany<Payload>(ids.map((id) => `item:${id}`), store);
}
export async function removeItems(index: LibraryItem[], ids: string[]) {
  await delMany(ids.map((id) => `item:${id}`), store);
  await set(INDEX, index, store);
}
export async function clearAll(index: LibraryItem[]) {
  await delMany(index.map((item) => `item:${item.id}`), store);
  await del(INDEX, store);
}
