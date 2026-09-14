import assert from 'node:assert/strict';
import { it } from 'node:test';
import { arcLengthDashes } from '../render/paths.ts';
import { simulate } from './simulation.ts';
import { STAGES } from '../data/stages.ts';

it('preserves visible dashes when every simulation segment is shorter than a dash', () => {
  const points = Array.from({ length: 101 }, (_, i) => ({ x: i / 100, y: 0 }));
  const lines = arcLengthDashes(points, 0.14, 0.1);
  assert.ok(lines.length > 40);
  const drawnLength = lines.reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0);
  assert.ok(Math.abs(drawnLength - 0.6) < 1e-10);
  assert.deepEqual(lines[0]![0], points[0]);
  assert.deepEqual(lines.at(-1)![1], points.at(-1));
});

it('draws the exact recorded curve without moving any point off its source segment', () => {
  const stage = STAGES[0]!;
  const recording = simulate(stage, stage.lenses.map((lens) => lens.solution));
  const points = recording.samples.map((sample) => sample.position);
  const lines = arcLengthDashes(points);
  assert.ok(lines.length > 200);
  assert.ok(lines.every(([a, b]) => [a.x, a.y, b.x, b.y].every(Number.isFinite)));
  assert.throws(() => arcLengthDashes(points, 0), RangeError);
  assert.deepEqual(arcLengthDashes([{ x: 0, y: 0 }, { x: 0, y: 0 }]), []);
});
