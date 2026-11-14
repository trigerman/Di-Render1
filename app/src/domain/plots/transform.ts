/** Linear world transform, matching Fabric's rotation/scale and QR decomposition. */
export type LinearTransform = readonly [number, number, number, number];
export const identityTransform: LinearTransform = [1, 0, 0, 1];
export function plotTransform(parent: LinearTransform, object: { angle: number; scaleX: number; scaleY: number }) {
  const radians = object.angle * Math.PI / 180, cos = Math.abs(radians) / (Math.PI / 2) === 1 || Math.abs(radians) / (Math.PI / 2) === 3 ? 0 : Math.abs(radians) / (Math.PI / 2) === 2 ? -1 : Math.cos(radians), sin = radians / (Math.PI / 2) === 1 ? Math.sign(radians) : radians / (Math.PI / 2) === 2 ? 0 : radians / (Math.PI / 2) === 3 ? -Math.sign(radians) : Math.sin(radians);
  const a = cos * object.scaleX, b = sin * object.scaleX, c = -sin * object.scaleY, d = cos * object.scaleY;
  const matrix: LinearTransform = [parent[0] * a + parent[2] * b, parent[1] * a + parent[3] * b, parent[0] * c + parent[2] * d, parent[1] * c + parent[3] * d];
  const scaleX = Math.sqrt(Math.pow(matrix[0], 2) + Math.pow(matrix[1], 2)), scaleY = Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) / scaleX;
  const skewX = Math.atan2(matrix[0] * matrix[2] + matrix[1] * matrix[3], Math.pow(matrix[0], 2) + Math.pow(matrix[1], 2)) * 180 / Math.PI;
  return { matrix, scaleX, scaleY, skewX };
}
