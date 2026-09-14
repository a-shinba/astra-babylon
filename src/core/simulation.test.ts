import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STAGES } from '../data/stages.ts';
import { acceleration, circleEntry, clampPlacement, MAX_DURATION, ringCrossing, sampleRecording, simulate, TIME_STEP } from './simulation.ts';
import type { Stage, Vec2 } from './types.ts';

function highSpeedStage(ringXs: readonly [number, number, number]): Stage {
  const base = STAGES[0]!;
  return {
    ...base,
    bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
    launch: { position: { x: 0, y: 0 }, velocity: { x: 1000, y: 0 } },
    lenses: [{ ...base.lenses[0]!, strength: 0 }],
    rings: [
      { ...base.rings[0], position: { x: ringXs[0], y: 0 }, normal: { x: 1, y: 0 } },
      { ...base.rings[1], position: { x: ringXs[1], y: 0 }, normal: { x: 1, y: 0 } },
      { ...base.rings[2], position: { x: ringXs[2], y: 0 }, normal: { x: 1, y: 0 } },
    ],
    catcher: { position: { x: 4, y: 0 }, radius: 0.3 },
  };
}

describe('authored stages', () => {
  for (const stage of STAGES) {
    it(`${stage.id}: its saved solution passes all three rings and reaches the cup`, () => {
      const placements = stage.lenses.map((lens) => lens.solution);
      const recording = simulate(stage, placements);
      assert.equal(recording.outcome, 'caught');
      assert.equal(recording.ringsPassed, 3);
      assert.ok(recording.duration > 0 && recording.duration <= MAX_DURATION);
      assert.deepEqual(recording.events.filter((event) => event.kind === 'ring').map((event) => event.index), [0, 1, 2]);
      assert.deepEqual(simulate(stage, placements.map((position) => ({ ...position }))), recording);
      assert.ok(recording.samples.every((sample) =>
        [sample.time, sample.position.x, sample.position.y, sample.velocity.x, sample.velocity.y].every(Number.isFinite)));
      for (let i = 1; i < recording.samples.length; i++) {
        assert.ok(recording.samples[i]!.time > recording.samples[i - 1]!.time);
        assert.ok(recording.samples[i]!.time - recording.samples[i - 1]!.time <= TIME_STEP + 1e-12);
      }
      assert.notEqual(simulate(stage, stage.lenses.map((lens) => lens.initial)).outcome, 'caught');
    });
  }
});

describe('swept aperture and collector detection', () => {
  const ring = { ...STAGES[0]!.rings[0], position: { x: 0, y: 0 }, normal: { x: 5, y: 0 } };
  it('detects high-speed passage in either direction, without proximity false positives', () => {
    assert.equal(ringCrossing({ x: -20, y: 0 }, { x: 20, y: 0 }, ring), 0.5);
    assert.equal(ringCrossing({ x: 20, y: 0 }, { x: -20, y: 0 }, ring), 0.5);
    assert.equal(ringCrossing({ x: -20, y: 2 }, { x: 20, y: 2 }, ring), null);
    assert.equal(ringCrossing({ x: -1, y: 0 }, { x: 0, y: 0 }, ring), 1);
    assert.equal(ringCrossing({ x: 0, y: 0 }, { x: 1, y: 0 }, ring), null);
  });
  it('processes all crossings in one time step in physical order', () => {
    const stage = highSpeedStage([1, 2, 3]);
    const recording = simulate(stage, stage.lenses.map((lens) => lens.solution));
    assert.equal(recording.outcome, 'caught');
    assert.equal(recording.ringsPassed, 3);
    assert.ok(recording.duration < TIME_STEP);
    const expected = [0.001, 0.002, 0.003, 0.0037];
    recording.events.forEach((event, i) => assert.ok(Math.abs(event.time - expected[i]!) < 1e-12));
  });
  it('does not credit an out-of-order ring or catch without all three notes', () => {
    const stage = highSpeedStage([2, 1, 3]);
    const recording = simulate(stage, stage.lenses.map((lens) => lens.solution));
    assert.equal(recording.outcome, 'incomplete');
    assert.equal(recording.ringsPassed, 1);
  });
  it('stops at the board boundary before a later ring in the same step', () => {
    const stage = highSpeedStage([3, 4, 5]);
    const recording = simulate({ ...stage, bounds: { ...stage.bounds, maxX: 2 } }, stage.lenses.map((lens) => lens.solution));
    assert.equal(recording.outcome, 'escaped');
    assert.equal(recording.ringsPassed, 0);
    assert.equal(recording.samples.at(-1)!.position.x, 2);
  });
  it('detects an entire circle crossing, even with both endpoints outside', () => {
    assert.equal(circleEntry({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 1), 0.45);
    assert.equal(circleEntry({ x: -10, y: 2 }, { x: 10, y: 2 }, { x: 0, y: 0 }, 1), null);
    assert.equal(circleEntry({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 1), null);
  });
});

describe('numerical stability and recording', () => {
  it('has finite, zero force exactly at a softened gravity center', () => {
    const stage = STAGES[0]!;
    const center = stage.launch.position;
    assert.deepEqual(acceleration(center, stage, [center]), { x: 0, y: 0 });
    const recording = simulate({ ...stage, launch: { position: center, velocity: { x: 0, y: 0 } } }, [center]);
    assert.equal(recording.outcome, 'timeout');
    assert.equal(recording.duration, 12);
    assert.equal(recording.samples.length, 1441);
    assert.ok(recording.samples.every((sample) => sample.position.x === center.x && sample.position.y === center.y));
  });
  it('remains finite for a fast trajectory through a lens center', () => {
    const stage = highSpeedStage([20, 30, 40]);
    const recording = simulate({ ...stage, lenses: [{ ...stage.lenses[0]!, strength: 100 }] }, [{ x: 1, y: 0 }]);
    assert.ok(recording.samples.every((s) => Number.isFinite(s.position.x) && Number.isFinite(s.velocity.x)));
  });
  it('interpolates immutable stored samples; seeking backward never integrates physics', () => {
    const stage = STAGES[0]!;
    const recording = simulate(stage, stage.lenses.map((lens) => lens.solution));
    const original = structuredClone(recording);
    for (const time of [4.8, 0.017, 3.21, -10, 100, 0]) {
      const sample = sampleRecording(recording, time);
      assert.ok(sample.time >= 0 && sample.time <= recording.duration);
      assert.ok(Number.isFinite(sample.position.x));
    }
    assert.deepEqual(sampleRecording(recording, 0).position, stage.launch.position);
    assert.deepEqual(sampleRecording(recording, 100).position, recording.samples.at(-1)!.position);
    assert.deepEqual(recording, original);
    assert.throws(() => sampleRecording(recording, NaN), RangeError);
  });
  it('validates input and keeps the full lens inside the board', () => {
    const stage = STAGES[0]!;
    const position: Vec2 = { x: 100, y: -100 };
    assert.deepEqual(clampPlacement(position, stage.bounds), { x: 8.1, y: -4.4 });
    assert.throws(() => clampPlacement({ x: NaN, y: 0 }, stage.bounds), RangeError);
    assert.throws(() => simulate(stage, []), RangeError);
    assert.throws(() => simulate(stage, [{ x: Infinity, y: 0 }]), RangeError);
  });
});
