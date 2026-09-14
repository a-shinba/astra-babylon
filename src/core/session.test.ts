import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STAGES } from '../data/stages.ts';
import { WorkshopSession } from './session.ts';
import type { RunEvent } from './types.ts';

describe('workshop state transitions', () => {
  it('uses the exact prediction recording for real playback at 30, 60 and 144 Hz', () => {
    const eventSets: RunEvent[][] = [];
    for (const hz of [30, 60, 144]) {
      const session = new WorkshopSession(STAGES);
      session.loop = false;
      session.applySolution();
      const prediction = session.prediction;
      session.play();
      assert.equal(session.recording, prediction);
      const events: RunEvent[] = [];
      while (session.phase === 'playing') events.push(...session.advance(1 / hz));
      assert.equal(session.phase, 'complete');
      assert.equal(session.time, prediction.duration);
      assert.equal(session.lastOutcome, 'caught');
      eventSets.push(events);
    }
    assert.deepEqual(eventSets[0], eventSets[1]);
    assert.deepEqual(eventSets[1], eventSets[2]);
  });
  it('locks placement during playback and pauses without changing the recording', () => {
    const session = new WorkshopSession(STAGES);
    const initial = structuredClone(session.placements);
    session.play();
    session.advance(0.8);
    assert.equal(session.moveLens(0, { x: 5, y: 5 }), false);
    session.pause();
    assert.equal(session.phase, 'paused');
    assert.deepEqual(session.advance(5), []);
    assert.equal(session.time, 0.8);
    assert.deepEqual(session.placements, initial);
    session.play();
    assert.equal(session.phase, 'playing');
    assert.equal(session.time, 0.8);
  });
  it('scrubs silently and restarts from zero rather than branching', () => {
    const session = new WorkshopSession(STAGES);
    session.play();
    session.advance(3);
    session.seek(1);
    assert.equal(session.phase, 'scrubbing');
    assert.deepEqual(session.advance(3), []);
    assert.equal(session.time, 1);
    session.play();
    assert.equal(session.time, 0);
    assert.equal(session.phase, 'playing');
  });
  it('invalidates the timeline on placement changes and retains the previous ghost', () => {
    const session = new WorkshopSession(STAGES);
    session.play();
    session.advance(2);
    const previous = session.recording;
    session.seek(1);
    session.moveLens(0, { x: 0.2, y: 1 });
    assert.equal(session.time, 0);
    assert.equal(session.phase, 'editing');
    assert.equal(session.recording, null);
    assert.equal(session.ghost, previous);
    assert.notEqual(session.prediction, previous);
    assert.throws(() => session.seek(1), /no recorded run/);
  });
  it('returns to editing immediately after a failed run', () => {
    const session = new WorkshopSession(STAGES);
    session.play();
    session.advance(12);
    assert.equal(session.phase, 'editing');
    assert.ok(session.recording);
    assert.equal(session.ghost, session.recording);
    session.moveLens(0, { x: 0, y: 0.8 });
    session.play();
    assert.equal(session.time, 0);
  });
  it('loops completed recordings without accumulating simulated state', () => {
    const session = new WorkshopSession(STAGES);
    session.applySolution();
    session.play();
    const recording = session.recording!;
    session.advance(12);
    assert.equal(session.phase, 'complete');
    session.advance(1.5);
    assert.equal(session.time, 0);
    assert.equal(session.recording, recording);
    const nextCycle = session.advance(12);
    assert.deepEqual(nextCycle, recording.events);
    assert.deepEqual([...session.completedStages], [session.stage.id]);
  });
  it('resets recordings, ghosts, placement, selection and playback time', () => {
    const session = new WorkshopSession(STAGES);
    session.applySolution();
    session.play();
    session.advance(2);
    session.reset();
    assert.equal(session.phase, 'editing');
    assert.equal(session.recording, null);
    assert.equal(session.ghost, null);
    assert.equal(session.time, 0);
    assert.deepEqual(session.placements, session.stage.lenses.map((lens) => lens.initial));
  });
  it('rejects invalid times and selectors explicitly', () => {
    const session = new WorkshopSession(STAGES);
    assert.throws(() => session.advance(-1), RangeError);
    assert.throws(() => session.advance(NaN), RangeError);
    assert.throws(() => session.selectLens(20), RangeError);
    assert.throws(() => session.selectStage(20), RangeError);
    assert.throws(() => new WorkshopSession([]), RangeError);
  });
});
