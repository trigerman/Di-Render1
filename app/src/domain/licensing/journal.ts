/**
 * How a licence behaves when a figure is published in a journal.
 *
 * - "open": public domain, CC0, CC BY and permissive code licences (MIT, BSD).
 *   Compatible with CC BY open-access journals and with subscription journals;
 *   only the credit line is required (where the licence asks for one).
 * - "share-alike": CC BY-SA. A figure that adapts the drawing must itself be
 *   released under CC BY-SA, so CC BY journals (e.g. PLOS) and journals that
 *   take copyright transfer usually cannot accept it without the creator's permission.
 * - "restricted": NonCommercial or NoDerivatives terms, or an unknown licence.
 */
export type JournalSafety = "open" | "share-alike" | "restricted";

/** Value of the library's licence filter that keeps only "open" drawings. */
export const JOURNAL_SAFE_FILTER = "journal-safe";

export function journalSafety(licenseId: string): JournalSafety {
  const id = licenseId.toUpperCase();
  if (id === "UNKNOWN" || id.includes("-NC") || id.includes("-ND")) return "restricted";
  if (id.includes("-SA")) return "share-alike";
  return "open";
}

export const isJournalSafe = (licenseId: string) => journalSafety(licenseId) === "open";
