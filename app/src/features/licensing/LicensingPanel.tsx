import { AlertTriangle, CheckCircle2, Copy, FileCheck2, FileDown, Link2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProjectAsset } from "../../domain/assets/schema";
import { checkPublication, figureLegend } from "../../domain/licensing/attribution";
import { journalSafety } from "../../domain/licensing/journal";
import type { OpenBioFigureProject } from "../../domain/project/schema";

interface LicensingPanelProps {
  project: OpenBioFigureProject;
  onDownload: (format: "markdown" | "text") => void;
}

function creditLine(asset: ProjectAsset) {
  if (asset.license.id === "UNKNOWN")
    return "License unknown: check the source's terms before publishing.";
  return asset.license.attributionRequired
    ? `Credit: ${asset.attribution.text}`
    : "No credit required.";
}

export function LicensingPanel({ project, onDownload }: LicensingPanelProps) {
  const check = useMemo(() => checkPublication(project), [project]);
  const legend = useMemo(() => figureLegend(check), [check]);
  const [copied, setCopied] = useState(false);
  const { assets, mediaCredits } = check;
  if (!assets.length && !mediaCredits.length && !check.ownImageCount)
    return (
      <div className="empty-state compact">
        <FileCheck2 />
        <p>Place a drawing to see its license and credit.</p>
      </div>
    );

  const copyLegend = async () => {
    try {
      await navigator.clipboard.writeText(legend);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* the text stays selectable in the box */ }
  };

  return (
    <div className="licensing-panel">
      <section className={`publication-check ${check.journalReady ? "ok" : "warn"}`} aria-live="polite">
        <strong>
          {check.journalReady ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          {check.journalReady ? "Ready to publish" : "Check before you publish"}
        </strong>
        {check.journalReady ? (
          <p>
            Everything in this figure is public domain, CC0, CC BY or MIT. That suits CC BY open-access journals and
            subscription journals, as long as the legend below goes in the figure caption or acknowledgments.
          </p>
        ) : (
          <ul>{check.warnings.map((line) => <li key={line}>{line}</li>)}</ul>
        )}
        {check.notes.length > 0 && <ul>{check.notes.map((line) => <li key={line}>{line}</li>)}</ul>}
      </section>

      {legend && (
        <label className="legend-box">
          <span>Figure legend credit</span>
          <textarea readOnly value={legend} onFocus={(event) => event.currentTarget.select()} />
          <button type="button" className="button" onClick={() => void copyLegend()}>
            <Copy /> {copied ? "Copied" : "Copy legend"}
          </button>
        </label>
      )}

      {mediaCredits.map((entry) => (
        <article className="credit-card" key={entry.mediaId}>
          <div>
            <strong>{entry.name}</strong>
            <span>Generated image</span>
          </div>
          <span className="license-pill">{entry.credit.licenseId}</span>
          <p>Cite: {entry.credit.text}</p>
        </article>
      ))}

      {assets.map((asset) => {
        const shareAlike = journalSafety(asset.license.id) === "share-alike";
        return (
          <article className={`credit-card${shareAlike ? " share-alike" : ""}`} key={asset.id}>
            <div>
              <strong>{asset.title}</strong>
              <span>{asset.creator.name}</span>
            </div>
            <span className="license-pill">{asset.license.id}</span>
            <p>{creditLine(asset)}</p>
            {shareAlike && (
              <p>ShareAlike: swap it for a journal-safe drawing (Assets › Filters › License › Journal-safe) unless your journal accepts CC BY-SA.</p>
            )}
            {asset.source.sourceUrl && asset.verified ? (
              <a href={asset.source.sourceUrl} target="_blank" rel="noopener noreferrer">
                Original source <Link2 />
              </a>
            ) : <p>{asset.source.sourceUrl ?? "Source not supplied"} (self-declared)</p>}
          </article>
        );
      })}
      {(assets.some((asset) => asset.license.attributionRequired) || mediaCredits.length > 0) && (
        <div className="attribution-actions">
          <button
            type="button"
            className="button"
            onClick={() => onDownload("markdown")}
          >
            <FileDown /> ATTRIBUTIONS.md
          </button>
          <button
            type="button"
            className="button"
            onClick={() => onDownload("text")}
          >
            <FileDown /> Attribution.txt
          </button>
        </div>
      )}
    </div>
  );
}
