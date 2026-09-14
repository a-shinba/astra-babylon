import { interpolate } from '../core/simulation.ts';
import type { Vec2 } from '../core/types.ts';

export function arcLengthDashes(points: readonly Vec2[], dashLength = 0.14, gapLength = 0.1): [Vec2, Vec2][] {
  if (!Number.isFinite(dashLength) || !Number.isFinite(gapLength) || dashLength <= 0 || gapLength <= 0) {
    throw new RangeError('Dash and gap lengths must be finite and positive.');
  }
  const lines: [Vec2, Vec2][] = [];
  let drawing = true;
  let remaining = dashLength;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let traversed = 0;
    while (traversed < length - 1e-10) {
      const portion = Math.min(remaining, length - traversed);
      if (drawing) lines.push([interpolate(a, b, traversed / length), interpolate(a, b, (traversed + portion) / length)]);
      traversed += portion;
      remaining -= portion;
      if (remaining < 1e-10) {
        drawing = !drawing;
        remaining = drawing ? dashLength : gapLength;
      }
    }
  }
  return lines;
}
