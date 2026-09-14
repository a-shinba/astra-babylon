export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface LensDefinition {
  readonly label: string;
  readonly strength: number;
  readonly initial: Vec2;
  readonly solution: Vec2;
}

export interface Ring {
  readonly position: Vec2;
  readonly normal: Vec2;
  readonly radius: number;
  readonly midi: number;
  readonly note: string;
}

export interface Stage {
  readonly id: string;
  readonly numeral: string;
  readonly title: string;
  readonly subtitle: string;
  readonly headline: readonly [string, string];
  readonly description: string;
  readonly hint: string;
  readonly bounds: Bounds;
  readonly launch: { readonly position: Vec2; readonly velocity: Vec2 };
  readonly lenses: readonly LensDefinition[];
  readonly rings: readonly [Ring, Ring, Ring];
  readonly catcher: { readonly position: Vec2; readonly radius: number };
}

export interface Sample {
  readonly time: number;
  readonly position: Vec2;
  readonly velocity: Vec2;
}

export type Outcome = 'caught' | 'escaped' | 'incomplete' | 'timeout';

export type RunEvent =
  | { readonly kind: 'ring'; readonly time: number; readonly position: Vec2; readonly index: number }
  | { readonly kind: 'finish'; readonly time: number; readonly position: Vec2; readonly outcome: Outcome };

export interface Recording {
  readonly samples: readonly Sample[];
  readonly events: readonly RunEvent[];
  readonly duration: number;
  readonly outcome: Outcome;
  readonly ringsPassed: number;
}

export type Phase = 'editing' | 'playing' | 'paused' | 'scrubbing' | 'complete';
