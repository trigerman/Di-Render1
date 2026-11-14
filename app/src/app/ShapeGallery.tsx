import { useState } from "react";
import { Shapes } from "lucide-react";
import { SHAPE_DEFINITIONS, shapeGeometry, type ShapeId } from "../domain/shapes/registry";

const CATEGORIES = ["Basic", "Block arrows", "Flowchart", "Callouts"] as const;

export function ShapeGallery({ onInsert }: { onInsert: (id: ShapeId) => void }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase("en");
  return (
    <details className="shape-gallery">
      <summary className="toolbar-tool" aria-label="Insert shapes" title="Insert shapes">
        <Shapes aria-hidden="true" /><span>Shapes</span>
      </summary>
      <div className="shape-gallery-panel" onKeyDown={event => {
        if (event.key === "Escape") {
          event.stopPropagation();
          (event.currentTarget.parentElement as HTMLDetailsElement).open = false;
          (event.currentTarget.parentElement?.querySelector("summary") as HTMLElement)?.focus();
        }
      }}>
        <label className="shape-gallery-search">
          <span className="visually-hidden">Search shapes</span>
          <input type="search" placeholder="Search shapes" value={query} onChange={event => setQuery(event.currentTarget.value)} />
        </label>
        <div className="shape-gallery-scroll">
          {CATEGORIES.map(category => {
            const matches = SHAPE_DEFINITIONS.filter(shape => shape.category === category &&
              (!normalized || `${shape.name} ${shape.id} ${category}`.toLocaleLowerCase("en").includes(normalized)));
            if (!matches.length) return null;
            return <section key={category} aria-label={category}>
              <h3>{category}</h3>
              <div className="shape-gallery-grid">
                {matches.map(shape => <button
                  type="button"
                  key={shape.id}
                  title={shape.name}
                  aria-label={`Insert ${shape.name}`}
                  onClick={event => {
                    onInsert(shape.id);
                    (event.currentTarget.closest("details") as HTMLDetailsElement).open = false;
                  }}
                >
                  <svg viewBox={`-8 -8 ${shape.width + 16} ${shape.height + 16}`} aria-hidden="true">
                    {shapeGeometry(shape.id, 0.4, shape.width, shape.height).paths.map((path, index) =>
                      <path key={index} d={path.d} fill={path.fill ? "var(--shape-preview-fill)" : "none"}
                        stroke={path.stroke ? "currentColor" : "none"} strokeWidth="1.4"
                        vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />)}
                  </svg>
                  <span>{shape.name}</span>
                </button>)}
              </div>
            </section>;
          })}
          {!SHAPE_DEFINITIONS.some(shape => `${shape.name} ${shape.id} ${shape.category}`.toLocaleLowerCase("en").includes(normalized)) && <p>No matching shapes</p>}
        </div>
      </div>
    </details>
  );
}
