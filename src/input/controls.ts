import type { WorkshopSession } from '../core/session.ts';
import type { Instrument } from '../render/instrument.ts';
import type { Vec2 } from '../core/types.ts';

interface Actions {
  select(index: number): void;
  move(index: number, position: Vec2): void;
  play(): void;
  reset(): void;
  mute(): void;
  edit(): void;
}

export class WorkshopControls {
  private readonly canvas: HTMLCanvasElement;
  private readonly session: WorkshopSession;
  private readonly renderer: Instrument;
  private readonly actions: Actions;
  private readonly abort = new AbortController();
  private drag: { pointer: number; index: number; offset: Vec2 } | null = null;

  constructor(canvas: HTMLCanvasElement, handles: HTMLElement, session: WorkshopSession, renderer: Instrument, actions: Actions) {
    this.canvas = canvas;
    this.session = session;
    this.renderer = renderer;
    this.actions = actions;
    const options = { signal: this.abort.signal };
    canvas.addEventListener('pointerdown', this.pointerDown, options);
    handles.addEventListener('pointerdown', this.pointerDown, options);
    window.addEventListener('pointermove', this.pointerMove, options);
    window.addEventListener('pointerup', this.pointerUp, options);
    window.addEventListener('pointercancel', this.pointerUp, options);
    canvas.addEventListener('lostpointercapture', this.pointerUp, options);
    document.addEventListener('keydown', this.keyDown, options);
  }

  private pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.session.canEdit || this.drag) return;
    const handle = event.target instanceof Element ? event.target.closest<HTMLElement>('.lens-handle') : null;
    const index = handle ? Number(handle.dataset.lens) : this.renderer.pickLens(event.clientX, event.clientY);
    if (index === null) return;
    const point = this.renderer.boardPoint(event.clientX, event.clientY);
    if (!point) return;
    this.actions.select(index);
    const lens = this.session.placements[index]!;
    this.drag = { pointer: event.pointerId, index, offset: { x: lens.x - point.x, y: lens.y - point.y } };
    this.canvas.setPointerCapture(event.pointerId);
    document.documentElement.classList.add('is-dragging');
    event.preventDefault();
  };

  private pointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointer) return;
    if (!this.session.canEdit) {
      this.cancel();
      return;
    }
    const point = this.renderer.boardPoint(event.clientX, event.clientY);
    if (!point) return;
    this.actions.move(this.drag.index, { x: point.x + this.drag.offset.x, y: point.y + this.drag.offset.y });
    event.preventDefault();
  };

  private pointerUp = (event: PointerEvent): void => {
    if (this.drag?.pointer === event.pointerId) this.cancel();
  };

  private keyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey || document.querySelector('dialog[open]')) return;
    const target = event.target;
    if ((target instanceof HTMLInputElement && target.type !== 'range') || target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
    if (event.code === 'Space') {
      const lensControl = target instanceof Element && target.closest('.lens-choice, .lens-handle');
      if ((target instanceof HTMLButtonElement && !lensControl) || target instanceof HTMLAnchorElement) return;
      event.preventDefault();
      if (!event.repeat) this.actions.play();
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'm' || key === 'r' || key === 'escape') {
      event.preventDefault();
      if (event.repeat) return;
      if (key === 'm') this.actions.mute();
      if (key === 'r') this.actions.reset();
      if (key === 'escape') this.actions.edit();
      return;
    }
    if (target instanceof HTMLInputElement) return;
    if (!this.session.canEdit) return;
    if (/^[123]$/.test(key)) {
      const index = Number(key) - 1;
      if (index < this.session.placements.length) {
        event.preventDefault();
        this.actions.select(index);
      }
      return;
    }
    const directions: Record<string, Vec2> = {
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: 1 }, ArrowDown: { x: 0, y: -1 },
    };
    const direction = directions[event.key];
    if (direction) {
      event.preventDefault();
      const step = event.shiftKey ? 0.025 : 0.12;
      const position = this.session.placements[this.session.selectedLens]!;
      this.actions.move(this.session.selectedLens, {
        x: position.x + direction.x * step, y: position.y + direction.y * step,
      });
    }
  };

  cancel(): void {
    const pointer = this.drag?.pointer;
    this.drag = null;
    if (pointer !== undefined && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
    document.documentElement.classList.remove('is-dragging');
  }

  dispose(): void {
    this.cancel();
    this.abort.abort();
  }
}
