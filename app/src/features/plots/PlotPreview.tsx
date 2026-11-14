import type { PlotScene } from '../../domain/plots/scene';
import { shortLabel } from '../../domain/data/report';
import { dataText as d, type Locale } from '../../i18n/messages';
export function PlotPreview({ scene, family, label, locale }: { scene: PlotScene; family: string; label: string; locale: Locale }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${scene.width} ${scene.height}`} role="img" aria-label={label} className="plot-preview">
    {scene.primitives.map((primitive, index) => {
      if (primitive.kind === 'rect') return <rect key={index} x={primitive.x} y={primitive.y} width={primitive.width} height={primitive.height} fill={primitive.fill} stroke={primitive.stroke} />;
      if (primitive.kind === 'line') return <line key={index} x1={primitive.x1} y1={primitive.y1} x2={primitive.x2} y2={primitive.y2} stroke={primitive.stroke} strokeWidth={primitive.strokeWidth ?? 1} />;
      if (primitive.kind === 'circle') return <circle key={index} cx={primitive.x} cy={primitive.y} r={primitive.radius} fill={primitive.fill} opacity={primitive.opacity} />;
      if (primitive.kind === 'path') return <path key={index} d={primitive.d} fill={primitive.fill} stroke={primitive.stroke} opacity={primitive.opacity} />;
      // Error frames end with the diagnostic; keep user data and title labels verbatim.
      const text = scene.error && index === scene.primitives.length - 1 ? shortLabel(d(locale, scene.error), Math.max(10, Math.floor(scene.width / (primitive.size * 0.6)))) : primitive.text;
      return <text key={index} x={primitive.x} y={primitive.y} fontSize={primitive.size} fontFamily={family} fill={primitive.fill} textAnchor={primitive.anchor} transform={primitive.angle ? `rotate(${primitive.angle} ${primitive.x} ${primitive.y})` : undefined}>{text}</text>;
    })}
  </svg>;
}
