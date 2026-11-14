/** Numeric DrawingML adapter for our bundled presets. Formulas are data, never JS. */
export interface DrawingPreset {
  adjustments: string[][];
  guides: string[][];
  textRect: string[];
  paths: { fill: boolean; stroke: boolean; width?: number; height?: number; commands: string[][] }[];
}

export interface ShapeGeometry {
  paths: { d: string; fill: boolean; stroke: boolean }[];
  textRect: { x: number; y: number; width: number; height: number };
}

const angleUnit = Math.PI / 10_800_000;
const fullTurn = 21_600_000;
const number = (value: number) => {
  if (!Number.isFinite(value)) throw new Error('Non-finite preset geometry.');
  return String(Math.round(value * 100_000) / 100_000);
};

export function drawingGeometry(preset: DrawingPreset, width: number, height: number, adjustments: Record<string, number> = {}): ShapeGeometry {
  if (!(width > 0 && height > 0 && Number.isFinite(width + height))) throw new Error('Invalid shape dimensions.');
  const guides = new Map<string, number>(Object.entries({w:width, h:height, l:0, t:0, r:width, b:height,
    hc:width/2, vc:height/2, ss:Math.min(width,height), ls:Math.max(width,height)}));
  const value = (token: string | undefined): number => {
    if (token === undefined) throw new Error('Missing preset operand.');
    if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
    const known = guides.get(token);
    if (known !== undefined) return known;
    const fraction = /^(w|h|ss)d(\d+)$/.exec(token);
    if (fraction) return guides.get(fraction[1]!)! / Number(fraction[2]);
    const angle = /^(\d*)cd(\d+)$/.exec(token);
    if (angle) return Number(angle[1] || 1) * fullTurn / Number(angle[2]);
    throw new Error(`Unknown preset operand: ${token}`);
  };
  const formula = (expression: string): number => {
    const [op, ...tokens] = expression.trim().split(/\s+/);
    const args = tokens.map(value);
    const x = args[0] ?? 0, y = args[1] ?? 0, z = args[2] ?? 0;
    switch (op) {
      case 'val': return x;
      case '+-': return x + y - z;
      case '*/': return z === 0 ? 0 : x * y / z;
      case '+/': return z === 0 ? 0 : (x + y) / z;
      case '?:': return x > 0 ? y : z;
      case 'abs': return Math.abs(x);
      case 'min': return Math.min(x,y);
      case 'max': return Math.max(x,y);
      case 'sqrt': return Math.sqrt(Math.max(0,x));
      case 'mod': return Math.hypot(x,y,z);
      case 'pin': return Math.max(x,Math.min(y,z));
      case 'sin': return x * Math.sin(y * angleUnit);
      case 'cos': return x * Math.cos(y * angleUnit);
      case 'tan': return x * Math.tan(y * angleUnit);
      case 'at2': return Math.atan2(y,x) / angleUnit;
      case 'cat2': return x * Math.cos(Math.atan2(z,y));
      case 'sat2': return x * Math.sin(Math.atan2(z,y));
      default: throw new Error(`Unsupported preset formula: ${op}`);
    }
  };
  for (const [name, expression] of preset.adjustments) guides.set(name!, adjustments[name!] ?? formula(expression!));
  for (const [name, expression] of preset.guides) guides.set(name!, formula(expression!));
  const paths = preset.paths.map(path => {
    const sx = width / (path.width ?? width), sy = height / (path.height ?? height);
    let x = 0, y = 0, startX = 0, startY = 0;
    const commands: string[] = [];
    const point = (px: number, py: number) => `${number(px * sx)} ${number(py * sy)}`;
    for (const [op, ...tokens] of path.commands) {
      if (op === 'Z') { commands.push('Z'); x = startX; y = startY; continue; }
      const values = tokens.map(value);
      if (op !== 'A') {
        x = values.at(-2)!; y = values.at(-1)!;
        if (op === 'M') { startX = x; startY = y; }
        commands.push(`${op} ${values.map((n,i) => number(n * (i % 2 ? sy : sx))).join(' ')}`);
        continue;
      }
      const [rx, ry, startAngle, sweep] = values as [number,number,number,number];
      // DrawingML angles point along a ray from the ellipse centre. SVG uses
      // ellipse parameters; converting the ray avoids kinks in non-circular arcs.
      const onEllipse = (angle: number) => {
        const theta = Math.atan2(rx * Math.sin(angle * angleUnit), ry * Math.cos(angle * angleUnit));
        return [rx * Math.cos(theta), ry * Math.sin(theta)] as const;
      };
      const [startDx,startDy] = onEllipse(startAngle);
      const cx = x - startDx, cy = y - startDy;
      // A full turn needs multiple SVG arcs. Quarter-turn pieces also avoid
      // ambiguous flags and preserve the upstream arc direction on ellipses.
      const segments = Math.max(1, Math.ceil(Math.abs(sweep) / (fullTurn / 4)));
      for (let i = 1; i <= segments; i++) {
        const [dx,dy] = onEllipse(startAngle + sweep * i / segments);
        x = cx + dx; y = cy + dy;
        commands.push(rx <= 0 || ry <= 0 ? `L ${point(x,y)}`
          : `A ${number(rx*sx)} ${number(ry*sy)} 0 0 ${sweep >= 0 ? 1 : 0} ${point(x,y)}`);
      }
    }
    return {d:commands.join(' '), fill:path.fill, stroke:path.stroke};
  });
  const [left,top,right,bottom] = preset.textRect.map(value) as [number,number,number,number];
  return {paths,textRect:{x:left,y:top,width:right-left,height:bottom-top}};
}
