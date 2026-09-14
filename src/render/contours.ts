import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { SOFTENING } from '../core/simulation.ts';
import type { Stage, Vec2 } from '../core/types.ts';

export function fieldContours(stage: Stage, placements: readonly Vec2[]): Vector3[][] {
  const columns = 68;
  const rows = 42;
  const { minX, maxX, minY, maxY } = stage.bounds;
  const dx = (maxX - minX) / columns;
  const dy = (maxY - minY) / rows;
  const field = new Float32Array((columns + 1) * (rows + 1));
  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x <= columns; x++) {
      let value = 0;
      placements.forEach((lens, i) => {
        const lx = minX + dx * x - lens.x;
        const ly = minY + dy * y - lens.y;
        value += stage.lenses[i]!.strength / Math.sqrt(lx * lx + ly * ly + SOFTENING * SOFTENING);
      });
      field[y * (columns + 1) + x] = value;
    }
  }
  const segments: Vector3[][] = [];
  const levels = [0.9, 1.15, 1.5, 1.95, 2.6, 3.5, 4.8, 6.6, 9, 12, 16];
  for (const level of levels) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const points = [
          { x, y }, { x: x + 1, y }, { x: x + 1, y: y + 1 }, { x, y: y + 1 },
        ];
        const hits: Vector3[] = [];
        for (let edge = 0; edge < 4; edge++) {
          const a = points[edge]!;
          const b = points[(edge + 1) % 4]!;
          const av = field[a.y * (columns + 1) + a.x]!;
          const bv = field[b.y * (columns + 1) + b.x]!;
          if ((av < level) === (bv < level)) continue;
          const t = (level - av) / (bv - av);
          hits.push(new Vector3(minX + (a.x + (b.x - a.x) * t) * dx, 0.383,
            minY + (a.y + (b.y - a.y) * t) * dy));
        }
        if (hits.length === 2) segments.push(hits);
        if (hits.length === 4) {
          segments.push([hits[0]!, hits[1]!], [hits[2]!, hits[3]!]);
        }
      }
    }
  }
  return segments;
}
