import type { Bounds, Outcome, Recording, Ring, RunEvent, Sample, Stage, Vec2 } from './types.ts';

export const TIME_STEP = 1 / 120;
export const MAX_DURATION = 12;
export const SOFTENING = 0.8;
export const LENS_MARGIN = 0.8;

export function clampPlacement(position: Vec2, bounds: Bounds): Vec2 {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new RangeError('Lens coordinates must be finite.');
  }
  return {
    x: Math.max(bounds.minX + LENS_MARGIN, Math.min(bounds.maxX - LENS_MARGIN, position.x)),
    y: Math.max(bounds.minY + LENS_MARGIN, Math.min(bounds.maxY - LENS_MARGIN, position.y)),
  };
}

export function acceleration(position: Vec2, stage: Stage, placements: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (let i = 0; i < placements.length; i++) {
    const lens = placements[i]!;
    const dx = lens.x - position.x;
    const dy = lens.y - position.y;
    const distanceSquared = dx * dx + dy * dy + SOFTENING * SOFTENING;
    const factor = stage.lenses[i]!.strength / (distanceSquared * Math.sqrt(distanceSquared));
    x += dx * factor;
    y += dy * factor;
  }
  return { x, y };
}

export function interpolate(a: Vec2, b: Vec2, fraction: number): Vec2 {
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
}

// A ring is a vertical aperture, not a proximity trigger. Test the swept segment
// against its plane, then against the opening, so fast stars cannot skip it.
export function ringCrossing(a: Vec2, b: Vec2, ring: Ring): number | null {
  const normalLength = Math.hypot(ring.normal.x, ring.normal.y);
  const nx = ring.normal.x / normalLength;
  const ny = ring.normal.y / normalLength;
  const before = (a.x - ring.position.x) * nx + (a.y - ring.position.y) * ny;
  const after = (b.x - ring.position.x) * nx + (b.y - ring.position.y) * ny;
  if (Math.abs(before) < 1e-10 || before * after > 0) return null;
  const fraction = before / (before - after);
  if (fraction < 0 || fraction > 1) return null;
  const point = interpolate(a, b, fraction);
  const lateral = (point.x - ring.position.x) * -ny + (point.y - ring.position.y) * nx;
  return Math.abs(lateral) <= ring.radius ? fraction : null;
}

export function circleEntry(a: Vec2, b: Vec2, center: Vec2, radius: number): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - center.x;
  const fy = a.y - center.y;
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return null;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-20) return null;
  const dot = fx * dx + fy * dy;
  const discriminant = dot * dot - lengthSquared * c;
  if (discriminant < 0) return null;
  const fraction = (-dot - Math.sqrt(discriminant)) / lengthSquared;
  return fraction >= 0 && fraction <= 1 ? fraction : null;
}

function boundaryExit(a: Vec2, b: Vec2, bounds: Bounds): number | null {
  let fraction = Infinity;
  if (b.x < bounds.minX) fraction = Math.min(fraction, (bounds.minX - a.x) / (b.x - a.x));
  if (b.x > bounds.maxX) fraction = Math.min(fraction, (bounds.maxX - a.x) / (b.x - a.x));
  if (b.y < bounds.minY) fraction = Math.min(fraction, (bounds.minY - a.y) / (b.y - a.y));
  if (b.y > bounds.maxY) fraction = Math.min(fraction, (bounds.maxY - a.y) / (b.y - a.y));
  return Number.isFinite(fraction) ? Math.max(0, fraction) : null;
}

export function simulate(stage: Stage, placements: readonly Vec2[]): Recording {
  if (placements.length !== stage.lenses.length) throw new RangeError('Incorrect lens count.');
  for (const placement of placements) {
    if (!Number.isFinite(placement.x) || !Number.isFinite(placement.y)) {
      throw new RangeError('Lens coordinates must be finite.');
    }
  }
  let position = { ...stage.launch.position };
  let velocity = { ...stage.launch.velocity };
  let force = acceleration(position, stage, placements);
  let ringsPassed = 0;
  const samples: Sample[] = [{ time: 0, position, velocity }];
  const events: RunEvent[] = [];

  const finish = (outcome: Outcome, time: number, point: Vec2): Recording => {
    events.push({ kind: 'finish', time, position: point, outcome });
    return { samples, events, duration: time, outcome, ringsPassed };
  };

  for (let step = 1; step <= MAX_DURATION / TIME_STEP; step++) {
    const time = (step - 1) * TIME_STEP;
    const nextPosition = {
      x: position.x + velocity.x * TIME_STEP + 0.5 * force.x * TIME_STEP * TIME_STEP,
      y: position.y + velocity.y * TIME_STEP + 0.5 * force.y * TIME_STEP * TIME_STEP,
    };
    const nextForce = acceleration(nextPosition, stage, placements);
    const nextVelocity = {
      x: velocity.x + 0.5 * (force.x + nextForce.x) * TIME_STEP,
      y: velocity.y + 0.5 * (force.y + nextForce.y) * TIME_STEP,
    };
    const crossings: { fraction: number; kind: 'ring' | 'catch' | 'exit'; index: number }[] = [];
    stage.rings.forEach((ring, index) => {
      if (index < ringsPassed) return;
      const fraction = ringCrossing(position, nextPosition, ring);
      if (fraction !== null) crossings.push({ fraction, kind: 'ring', index });
    });
    const catchFraction = circleEntry(position, nextPosition, stage.catcher.position, stage.catcher.radius);
    if (catchFraction !== null) crossings.push({ fraction: catchFraction, kind: 'catch', index: -1 });
    const exitFraction = boundaryExit(position, nextPosition, stage.bounds);
    if (exitFraction !== null) crossings.push({ fraction: exitFraction, kind: 'exit', index: -1 });
    crossings.sort((a, b) => a.fraction - b.fraction);

    for (const crossing of crossings) {
      const point = interpolate(position, nextPosition, crossing.fraction);
      const eventTime = time + crossing.fraction * TIME_STEP;
      if (crossing.kind === 'ring') {
        if (crossing.index === ringsPassed) {
          events.push({ kind: 'ring', time: eventTime, position: point, index: ringsPassed });
          ringsPassed++;
        }
      } else {
        samples.push({
          time: eventTime,
          position: point,
          velocity: interpolate(velocity, nextVelocity, crossing.fraction),
        });
        return finish(
          crossing.kind === 'exit' ? 'escaped' : ringsPassed === stage.rings.length ? 'caught' : 'incomplete',
          eventTime,
          point,
        );
      }
    }
    position = nextPosition;
    velocity = nextVelocity;
    force = nextForce;
    samples.push({ time: step * TIME_STEP, position, velocity });
  }
  return finish('timeout', MAX_DURATION, position);
}

export function sampleRecording(recording: Recording, time: number): Sample {
  if (!Number.isFinite(time)) throw new RangeError('Playback time must be finite.');
  const clamped = Math.max(0, Math.min(recording.duration, time));
  let low = 0;
  let high = recording.samples.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (recording.samples[middle]!.time <= clamped) low = middle;
    else high = middle;
  }
  const a = recording.samples[low]!;
  const b = recording.samples[high]!;
  const fraction = b.time === a.time ? 0 : (clamped - a.time) / (b.time - a.time);
  return {
    time: clamped,
    position: interpolate(a.position, b.position, fraction),
    velocity: interpolate(a.velocity, b.velocity, fraction),
  };
}

export function ringsAt(recording: Recording, time: number): number {
  return recording.events.filter((event) => event.kind === 'ring' && event.time <= time).length;
}
