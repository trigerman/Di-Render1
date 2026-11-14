import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowLeftRight,
  GripVertical,
  MousePointer2,
  PenTool,
} from "lucide-react";
import type { ChangeEvent } from "react";
import { FormField } from "../../components/ui/FormField";
import { IconButton } from "../../components/ui/IconButton";
import { isAdjustableShape } from "../../domain/shapes/registry";
import type {
  FabricEditor,
  LayerSnapshot,
  SelectionSnapshot,
} from "../../editor/FabricEditor";

interface PropertyInspectorProps {
  selection: SelectionSnapshot | null;
  layers: LayerSnapshot[];
  onUpdate: (value: Partial<SelectionSnapshot>) => void;
  onAlign: (mode: Parameters<FabricEditor["align"]>[0]) => void;
  onDistribute: (axis: Parameters<FabricEditor["distribute"]>[0]) => void;
  onEditArtwork: () => void;
  onReplaceImage: () => void;
}

export function PropertyInspector({
  selection,
  layers,
  onUpdate,
  onAlign,
  onDistribute,
  onEditArtwork,
  onReplaceImage,
}: PropertyInspectorProps) {
  if (!selection)
    return (
      <div className="empty-state compact">
        <span className="empty-state-icon">
          <MousePointer2 />
        </span>
        <strong>Nothing selected</strong>
        <p>Select an object on the canvas to edit its position and style.</p>
        <small>Shift-click to select multiple objects.</small>
      </div>
    );

  const numeric =
    (field: keyof SelectionSnapshot) =>
    (event: ChangeEvent<HTMLInputElement>) =>
      onUpdate({ [field]: event.currentTarget.valueAsNumber });

  return (
    <div className="inspector-content">
      <section className="inspector-section">
        <div className="section-title">
          <h3>Selection</h3>
          <span>{selection.kind}</span>
        </div>
        <FormField label="Layer name">
          <input
            value={selection.name}
            onChange={(event) => onUpdate({ name: event.currentTarget.value })}
          />
        </FormField>
        {selection.kind === "svg" && selection.count === 1 && <>
          <button type="button" className="button primary edit-artwork-entry" disabled={selection.locked} onClick={onEditArtwork}>
            <PenTool size={16} /> Edit artwork
          </button>
          <p className="artwork-hint">Edit individual parts, colors and geometry. You can also double-click the artwork.</p>
        </>}
        {selection.kind === "image" && selection.count === 1 && <button
          type="button" className="button primary edit-artwork-entry" onClick={onReplaceImage}>Replace image</button>}
      </section>
      <section className="inspector-section">
        <div className="section-title">
          <h3>Position</h3>
          <span>
            {selection.count > 1 ? `${selection.count} objects` : "px"}
          </span>
        </div>
        <div className="input-grid">
          <FormField label="X">
            <input type="number" value={selection.x} disabled={selection.kind === "connector" && Boolean(selection.connectorStart || selection.connectorEnd)} onChange={numeric("x")} />
          </FormField>
          <FormField label="Y">
            <input type="number" value={selection.y} disabled={selection.kind === "connector" && Boolean(selection.connectorStart || selection.connectorEnd)} onChange={numeric("y")} />
          </FormField>
          <FormField label="W">
            <input
              type="number"
              min="1"
              key={`${selection.id}:width:${selection.width}`}
              {...(selection.kind === 'plot' || selection.kind === 'group' ? {defaultValue:selection.width} : {value:selection.width})}
              disabled={selection.count > 1 || selection.kind === "connector" && Boolean(selection.connectorStart || selection.connectorEnd)}
              onChange={selection.kind === 'plot' || selection.kind === 'group' ? undefined : numeric("width")}
              onBlur={selection.kind === 'plot' || selection.kind === 'group' ? event => { if (event.target.validity.valid && event.target.valueAsNumber !== selection.width) onUpdate({width:event.target.valueAsNumber}); } : undefined}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            />
          </FormField>
          <FormField label="H">
            <input
              type="number"
              min="1"
              key={`${selection.id}:height:${selection.height}`}
              {...(selection.kind === 'plot' || selection.kind === 'group' ? {defaultValue:selection.height} : {value:selection.height})}
              disabled={selection.count > 1 || selection.kind === "connector" && Boolean(selection.connectorStart || selection.connectorEnd)}
              onChange={selection.kind === 'plot' || selection.kind === 'group' ? undefined : numeric("height")}
              onBlur={selection.kind === 'plot' || selection.kind === 'group' ? event => { if (event.target.validity.valid && event.target.valueAsNumber !== selection.height) onUpdate({height:event.target.valueAsNumber}); } : undefined}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            />
          </FormField>
          <FormField label="Rotation">
            <input
              type="number"
              value={selection.angle}
              disabled={selection.kind === "connector" && Boolean(selection.connectorStart || selection.connectorEnd)}
              onChange={numeric("angle")}
            />
          </FormField>
        </div>
      </section>
      {selection.kind === "connector" && selection.count === 1 && <section className="inspector-section">
        <div className="section-title"><h3>Connector</h3></div>
        {(["connectorStart", "connectorEnd"] as const).map((field, index) => {
          const attachment = selection[field];
          return <div key={field}>
            <FormField label={index === 0 ? "Start object" : "End object"}>
              <select value={attachment?.objectId ?? ""} onChange={event => onUpdate({[field]: event.currentTarget.value
                ? {objectId: event.currentTarget.value, site: attachment?.site ?? (index === 0 ? "right" : "left")} : null})}>
                <option value="">Free endpoint</option>
                {layers.filter(layer => layer.id !== selection.id && layer.kind !== "connector").map(layer =>
                  <option key={layer.id} value={layer.id}>{layer.name}</option>)}
              </select>
            </FormField>
            {attachment && <FormField label={index === 0 ? "Start side" : "End side"}>
              <select value={attachment.site} onChange={event => onUpdate({[field]: {...attachment,
                site: event.currentTarget.value as typeof attachment.site}})}>
                {(["center", "top", "right", "bottom", "left"] as const).map(site =>
                  <option key={site} value={site}>{site}</option>)}
              </select>
            </FormField>}
          </div>;
        })}
        <FormField label="Route">
          <select value={selection.connectorRouting ?? "straight"} onChange={event => onUpdate({
            connectorRouting: event.currentTarget.value as SelectionSnapshot["connectorRouting"]})}>
            <option value="straight">Straight</option><option value="elbow">Elbow</option><option value="curved">Curved</option>
          </select>
        </FormField>
      </section>}
      <section className="inspector-section">
        <div className="section-title">
          <h3>Style</h3>
        </div>
        {selection.kind === "image" && selection.count === 1 && <>
          <p className="artwork-hint">Crop the original local image without changing its saved pixels. Source: {selection.imageWidth} × {selection.imageHeight} px.</p>
          <div className="input-grid">
            {(["cropX", "cropY", "cropWidth", "cropHeight"] as const).map((field, index) =>
              <FormField key={field} label={["Crop X", "Crop Y", "Crop W", "Crop H"][index]!}>
                <input type="number" min={index < 2 ? 0 : 1} max={index % 2 ? selection.imageHeight : selection.imageWidth}
                  value={selection[field] ?? 0} onChange={numeric(field)} />
              </FormField>)}
          </div>
          <button type="button" className="button" onClick={() => onUpdate({cropX: 0, cropY: 0,
            cropWidth: selection.imageWidth, cropHeight: selection.imageHeight})}>Reset crop</button>
          <div className="toolbar-group">
            <button type="button" className="button" aria-pressed={selection.flipX} onClick={() => onUpdate({flipX: !selection.flipX})}>Flip horizontal</button>
            <button type="button" className="button" aria-pressed={selection.flipY} onClick={() => onUpdate({flipY: !selection.flipY})}>Flip vertical</button>
          </div>
        </>}
        {selection.kind === "shape" && selection.count === 1 && <>
          <FormField label="Shape text">
            <input value={selection.label ?? ""} maxLength={10_000}
              onChange={event => onUpdate({label: event.currentTarget.value})} />
          </FormField>
          {selection.shapeId && isAdjustableShape(selection.shapeId) && <FormField label={`Adjust shape · ${Math.round((selection.adjustment ?? 0.4) * 100)}%`}>
            <input type="range" min="0.15" max="0.85" step="0.01"
              value={selection.adjustment ?? 0.4}
              onChange={numeric("adjustment")} />
          </FormField>}
        </>}
        {selection.kind !== "image" && <div className="color-grid">
          <FormField label="Fill">
            <input
              type="color"
              value={selection.fill ?? "#ffffff"}
              onChange={(event) =>
                onUpdate({ fill: event.currentTarget.value })
              }
            />
          </FormField>
          <FormField label="Stroke">
            <input
              type="color"
              value={selection.stroke ?? "#263238"}
              onChange={(event) =>
                onUpdate({ stroke: event.currentTarget.value })
              }
            />
          </FormField>
        </div>}
        <FormField label={`Opacity · ${Math.round(selection.opacity * 100)}%`}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={selection.opacity}
            onChange={numeric("opacity")}
          />
        </FormField>
        {selection.kind !== "image" && <FormField label="Stroke width">
          <input
            type="number"
            min="0"
            max="40"
            step="0.5"
            value={selection.strokeWidth}
            onChange={numeric("strokeWidth")}
          />
        </FormField>}
        {selection.kind === "text" && (
          <>
            <FormField label="Font">
              <select
                value={selection.fontFamily}
                onChange={(event) =>
                  onUpdate({ fontFamily: event.currentTarget.value })
                }
              >
                <option value="IBM Plex Sans">
                  IBM Plex Sans
                </option>
                <option value="STIX Two Text">
                  STIX Two Text
                </option>
                <option value="IBM Plex Mono">IBM Plex Mono</option>
              </select>
            </FormField>
            <FormField label="Font size">
              <input
                type="number"
                min="6"
                max="240"
                value={selection.fontSize}
                onChange={numeric("fontSize")}
              />
            </FormField>
            <FormField label="Text alignment">
              <select
                value={selection.textAlign}
                onChange={(event) =>
                  onUpdate({
                    textAlign: event.currentTarget
                      .value as SelectionSnapshot["textAlign"],
                  })
                }
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
                <option value="justify">Justify</option>
              </select>
            </FormField>
          </>
        )}
      </section>
      <section className="inspector-section">
        <div className="section-title">
          <h3>Align & distribute</h3>
        </div>
        <div className="icon-grid six">
          <IconButton
            label="Align left"
            onClick={() => onAlign("left")}
            disabled={selection.count < 2}
          >
            <AlignStartVertical />
          </IconButton>
          <IconButton
            label="Align horizontal center"
            onClick={() => onAlign("center")}
            disabled={selection.count < 2}
          >
            <AlignCenterVertical />
          </IconButton>
          <IconButton
            label="Align right"
            onClick={() => onAlign("right")}
            disabled={selection.count < 2}
          >
            <AlignEndVertical />
          </IconButton>
          <IconButton
            label="Align top"
            onClick={() => onAlign("top")}
            disabled={selection.count < 2}
          >
            <AlignStartHorizontal />
          </IconButton>
          <IconButton
            label="Align vertical center"
            onClick={() => onAlign("middle")}
            disabled={selection.count < 2}
          >
            <AlignCenterHorizontal />
          </IconButton>
          <IconButton
            label="Align bottom"
            onClick={() => onAlign("bottom")}
            disabled={selection.count < 2}
          >
            <AlignEndHorizontal />
          </IconButton>
          <IconButton
            label="Distribute horizontally"
            onClick={() => onDistribute("horizontal")}
            disabled={selection.count < 3}
          >
            <ArrowLeftRight />
          </IconButton>
          <IconButton
            label="Distribute vertically"
            onClick={() => onDistribute("vertical")}
            disabled={selection.count < 3}
          >
            <GripVertical />
          </IconButton>
        </div>
      </section>
    </div>
  );
}
