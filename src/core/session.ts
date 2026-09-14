import { clampPlacement, simulate } from './simulation.ts';
import type { Outcome, Phase, Recording, RunEvent, Stage, Vec2 } from './types.ts';

export class WorkshopSession {
  readonly stages: readonly Stage[];
  readonly completedStages = new Set<string>();
  stageIndex = 0;
  selectedLens = 0;
  placements: Vec2[];
  prediction: Recording;
  recording: Recording | null = null;
  ghost: Recording | null = null;
  phase: Phase = 'editing';
  time = 0;
  loop = true;
  lastOutcome: Outcome | null = null;
  private loopDelay = 0;
  private resumePhase: 'playing' | 'complete' = 'playing';

  constructor(stages: readonly Stage[]) {
    if (stages.length === 0) throw new RangeError('At least one stage is required.');
    this.stages = stages;
    this.placements = this.stage.lenses.map((lens) => ({ ...lens.initial }));
    this.prediction = simulate(this.stage, this.placements);
  }

  get stage(): Stage {
    return this.stages[this.stageIndex]!;
  }

  get canEdit(): boolean {
    return this.phase === 'editing' || this.phase === 'scrubbing';
  }

  get isAdvancing(): boolean {
    return this.phase === 'playing' || (this.phase === 'complete' && this.loop);
  }

  selectLens(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.placements.length) {
      throw new RangeError('Unknown lens.');
    }
    this.selectedLens = index;
  }

  moveLens(index: number, position: Vec2): boolean {
    if (!this.canEdit) return false;
    this.selectLens(index);
    const next = clampPlacement(position, this.stage.bounds);
    const old = this.placements[index]!;
    if (Math.abs(old.x - next.x) < 1e-8 && Math.abs(old.y - next.y) < 1e-8) return false;
    this.ghost = this.recording ?? this.ghost;
    this.placements[index] = next;
    this.invalidateRecording();
    return true;
  }

  private invalidateRecording(): void {
    this.recording = null;
    this.prediction = simulate(this.stage, this.placements);
    this.phase = 'editing';
    this.time = 0;
    this.lastOutcome = null;
    this.loopDelay = 0;
  }

  applySolution(): void {
    if (!this.canEdit) return;
    this.ghost = this.recording ?? this.ghost;
    this.placements = this.stage.lenses.map((lens) => ({ ...lens.solution }));
    this.invalidateRecording();
  }

  play(): void {
    if (this.phase === 'paused') {
      this.phase = this.resumePhase;
      return;
    }
    this.recording = this.prediction;
    this.time = 0;
    this.loopDelay = 0;
    this.lastOutcome = null;
    this.phase = 'playing';
  }

  pause(): void {
    if (!this.isAdvancing) return;
    this.resumePhase = this.phase === 'complete' ? 'complete' : 'playing';
    this.phase = 'paused';
  }

  edit(): void {
    this.ghost = this.recording ?? this.ghost;
    this.phase = 'editing';
    this.time = 0;
    this.lastOutcome = null;
    this.loopDelay = 0;
  }

  seek(time: number): void {
    if (!this.recording) throw new Error('There is no recorded run to scrub.');
    if (!Number.isFinite(time)) throw new RangeError('Playback time must be finite.');
    this.phase = 'scrubbing';
    this.time = Math.max(0, Math.min(this.recording.duration, time));
    this.loopDelay = 0;
  }

  advance(delta: number): readonly RunEvent[] {
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Frame duration must be finite and nonnegative.');
    if (!this.isAdvancing || !this.recording) return [];
    if (this.phase === 'complete' && this.loopDelay > 0) {
      this.loopDelay = Math.max(0, this.loopDelay - delta);
      if (this.loopDelay === 0) this.time = 0;
      return [];
    }
    const before = this.time;
    this.time = Math.min(this.recording.duration, this.time + delta);
    const events = this.recording.events.filter((event) => event.time > before && event.time <= this.time);
    if (this.time >= this.recording.duration) {
      this.lastOutcome = this.recording.outcome;
      this.ghost = this.recording;
      if (this.recording.outcome === 'caught') {
        this.phase = 'complete';
        this.completedStages.add(this.stage.id);
        this.loopDelay = 1.4;
      } else {
        this.phase = 'editing';
      }
    }
    return events;
  }

  reset(): void {
    this.placements = this.stage.lenses.map((lens) => ({ ...lens.initial }));
    this.recording = null;
    this.ghost = null;
    this.selectedLens = 0;
    this.invalidateRecording();
  }

  selectStage(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.stages.length) {
      throw new RangeError('Unknown stage.');
    }
    this.stageIndex = index;
    this.reset();
  }
}
