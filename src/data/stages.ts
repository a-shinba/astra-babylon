import type { Stage } from '../core/types.ts';

export const STAGES: readonly Stage[] = [
  {
    id: 'attraction',
    numeral: 'I',
    title: '引力のひと筆',
    subtitle: 'THE FIRST ATTRACTION',
    headline: ['星に、', '寄り道を。'],
    description: 'ひとつの引力から、ひとつの旋律へ。\nレンズを動かして、3つの響きをつなごう。',
    hint: 'レンズを少し奥へ。薄い円に重ねると、3つのリングへ星が向かいます。',
    bounds: { minX: -8.9, maxX: 8.9, minY: -5.2, maxY: 5.2 },
    launch: { position: { x: -7.6, y: -2.6 }, velocity: { x: 2.35, y: 0.14 } },
    lenses: [
      { label: 'I', strength: 7.2, initial: { x: 0, y: -0.15 }, solution: { x: 0, y: 0.8 } },
    ],
    rings: [
      { position: { x: -3.807509, y: -2.301036 }, normal: { x: 2.576209, y: 0.279163 }, radius: 0.58, midi: 72, note: 'C' },
      { position: { x: 1.355589, y: -0.962718 }, normal: { x: 2.750200, y: 1.533042 }, radius: 0.58, midi: 76, note: 'E' },
      { position: { x: 4.482321, y: 1.577064 }, normal: { x: 1.857799, y: 1.867253 }, radius: 0.58, midi: 79, note: 'G' },
    ],
    catcher: { position: { x: 6.702102, y: 3.950746 }, radius: 0.65 },
  },
  {
    id: 'balance',
    numeral: 'II',
    title: 'ふたつの釣り合い',
    subtitle: 'A CONVERSATION OF FORCES',
    headline: ['引いて、', 'ゆずって。'],
    description: '引いて、ゆずって、また引いて。\nふたつのレンズで、星にS字の寄り道を。',
    hint: '左で上向きに、右で下向きに。薄い円が、ふたつの引力の釣り合う位置です。',
    bounds: { minX: -8.9, maxX: 8.9, minY: -5.2, maxY: 5.2 },
    launch: { position: { x: -7.8, y: -2.4 }, velocity: { x: 2.2, y: 0.1 } },
    lenses: [
      { label: 'I', strength: 9, initial: { x: -3.55, y: 0 }, solution: { x: -3, y: 0.6 } },
      { label: 'II', strength: 16, initial: { x: 3.35, y: -0.8 }, solution: { x: 2.7, y: -0.2 } },
    ],
    rings: [
      { position: { x: -4.104422, y: -1.924901 }, normal: { x: 2.995662, y: 0.744711 }, radius: 0.58, midi: 74, note: 'D' },
      { position: { x: 0.196961, y: 0.343469 }, normal: { x: 3.321799, y: 2.250141 }, radius: 0.58, midi: 78, note: 'F♯' },
      { position: { x: 5.087812, y: 1.210988 }, normal: { x: 1, y: 0.32 }, radius: 0.58, midi: 81, note: 'A' },
    ],
    catcher: { position: { x: 7.638366, y: 0.150701 }, radius: 0.65 },
  },
  {
    id: 'coda',
    numeral: 'III',
    title: '回り道の三重奏',
    subtitle: 'THE LONG WAY HOME',
    headline: ['星々の、', '三重奏。'],
    description: '急がずに、大きく回り込む。\n3つの引力で、ひとつの大きな弧を。',
    hint: 'まず左のリングへ。中央で弧を描き、右のレンズで受け皿へ。薄い円がお手本の位置です。',
    bounds: { minX: -8.9, maxX: 8.9, minY: -5.2, maxY: 5.2 },
    launch: { position: { x: -7.6, y: -2.2 }, velocity: { x: 0.25, y: 0.9 } },
    lenses: [
      { label: 'I', strength: 8, initial: { x: -0.35, y: -2.2 }, solution: { x: 0.2, y: -1.8 } },
      { label: 'II', strength: 10, initial: { x: 2.85, y: 1.55 }, solution: { x: 2.5, y: 1 } },
      { label: 'III', strength: 8, initial: { x: 3.95, y: -1.8 }, solution: { x: 4.4, y: -1.3 } },
    ],
    rings: [
      { position: { x: -6.252692, y: -0.082889 }, normal: { x: 0.957869, y: 0.913117 }, radius: 0.58, midi: 67, note: 'G' },
      { position: { x: -3.100809, y: 1.692916 }, normal: { x: 2.006811, y: 0.602287 }, radius: 0.58, midi: 71, note: 'B' },
      { position: { x: 0.491946, y: 2.02206 }, normal: { x: 1, y: 0.32 }, radius: 0.58, midi: 74, note: 'D' },
    ],
    catcher: { position: { x: 5.417212, y: -3.771419 }, radius: 0.65 },
  },
];
