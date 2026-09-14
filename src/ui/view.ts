import { ringsAt } from '../core/simulation.ts';
import type { WorkshopSession } from '../core/session.ts';
import type { Recording, Vec2 } from '../core/types.ts';

const paths = {
  play: '<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  sound: '<path d="m11 5-5 4H3v6h3l5 4ZM15 8c2 2 2 6 0 8M18 5c4 4 4 10 0 14"/>',
  muted: '<path d="m11 5-5 4H3v6h3l5 4ZM16 9l6 6m0-6-6 6"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>',
  arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  loop: '<path d="M4 9a7 7 0 0 1 12-4l3 3M19 3v5h-5M20 15a7 7 0 0 1-12 4l-3-3M5 21v-5h5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  hand: '<path d="M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v7c0 5-3 8-7 8-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2"/>',
} as const;

export function icon(name: keyof typeof paths): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

export function required<T extends HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing interface element: ${selector}`);
  return element;
}

function text(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

export class WorkshopView {
  readonly canvas: HTMLCanvasElement;
  readonly handles: HTMLElement;
  readonly timeline: HTMLInputElement;
  readonly help: HTMLDialogElement;
  private root: HTMLElement;
  private stageId = '';
  private lastRecording: Recording | null = null;
  private lensHandles: HTMLButtonElement[] = [];
  private noteElements: HTMLElement[] = [];
  private currentNoteCount = -1;
  private lastPrimary = '';

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <canvas id="instrument" aria-label="真鍮と陶器の天体装置。レンズはドラッグ、または選択後に矢印キーで動かせます。"></canvas>
      <div class="atmosphere" aria-hidden="true"></div>
      <div id="lens-handles" class="lens-handles"></div>
      <header class="masthead">
        <a class="brand" href="#workshop" aria-label="ORBITAL 星を鳴らす重力工房">
          <svg class="brand-mark" viewBox="0 0 50 50" fill="none" aria-hidden="true"><circle cx="25" cy="25" r="14"/><ellipse cx="25" cy="25" rx="23" ry="8" transform="rotate(-35 25 25)"/><circle cx="38" cy="16" r="2.4" fill="currentColor" stroke="none"/></svg>
          <span><span class="wordmark">ORBITAL</span><span class="brand-caption">星を鳴らす重力工房</span></span>
        </a>
        <span class="masthead-caption">A LITTLE GRAVITY. A LITTLE WONDER.</span>
        <div class="header-actions">
          <button id="mute" class="quiet-button" type="button" aria-pressed="false" title="ミュート（M）">${icon('sound')}<span>音あり</span></button>
          <span class="header-divider" aria-hidden="true"></span>
          <button id="help-button" class="help-button" type="button" aria-label="遊び方と設定">?</button>
        </div>
      </header>
      <main id="workshop">
        <aside class="chapter-copy">
          <div class="chapter-eyebrow"><span class="tiny-star" aria-hidden="true">✦</span><span id="chapter-eyebrow"></span></div>
          <h1 id="headline"></h1>
          <p id="description" class="description"></p>
          <div class="score" aria-label="順番に通す3つの共鳴リング">
            <span class="score-line" aria-hidden="true"></span>
            <span class="score-note"><b>01</b><span></span></span>
            <span class="score-note"><b>02</b><span></span></span>
            <span class="score-note"><b>03</b><span></span></span>
            <span class="score-arrival" aria-label="最後に受け皿へ">⌑</span>
          </div>
          <div class="interaction-guide">
            <div class="interaction-title">${icon('hand')}<span id="interaction-title">真鍮のレンズをドラッグ</span></div>
            <p id="interaction-detail">点線は、これから生まれる軌道。</p>
            <div id="lens-choices" class="lens-choices" role="group" aria-label="レンズを選択"></div>
            <output id="lens-position" class="coordinates"></output>
          </div>
          <button id="next-stage" class="next-stage" type="button" hidden><span>次の軌道へ</span>${icon('arrow')}</button>
          <p id="notice" class="notice" role="status" aria-live="polite"></p>
        </aside>
        <nav class="chapter-navigation" aria-label="ステージを選択">
          <div class="micro">THREE STUDIES IN RESONANCE</div>
          <div id="stage-tabs" class="stage-tabs"></div>
          <div id="chapter-subtitle" class="chapter-subtitle"></div>
        </nav>
        <div class="board-caption"><span class="caption-line"></span><span>DRAG TO COMPOSE · RELEASE TO LISTEN</span></div>
      </main>
      <footer class="transport">
        <div class="timeline-row">
          <label for="timeline" id="timeline-label">軌道の記録</label>
          <div class="timeline-track">
            <div id="timeline-markers" class="timeline-markers" aria-hidden="true"></div>
            <input id="timeline" type="range" min="0" max="12" step="0.001" value="0" disabled aria-label="直前の走行をスクラブ" aria-describedby="timeline-help"/>
          </div>
          <output id="timecode" class="timecode">0.00 <span>/ 12.00 s</span></output>
        </div>
        <div class="transport-row">
          <div class="playback-controls">
            <button id="play" class="primary-button" type="button">${icon('play')}<span>星を放つ</span><kbd>Space</kbd></button>
            <button id="edit" class="text-button" type="button" hidden>配置に戻る</button>
            <button id="reset" class="text-button reset-button" type="button" aria-label="初期配置" title="初期配置に戻す（R）">${icon('reset')}<span>初期配置</span></button>
            <span class="control-divider" aria-hidden="true"></span>
            <button id="hint" class="text-button hint-button" type="button"><span class="hint-spark" aria-hidden="true">✧</span><span>ヒント</span></button>
          </div>
          <div class="playback-status">
            <span id="route-status" class="route-status"></span>
            <button id="loop" class="loop-button" type="button" aria-pressed="true" title="成功した軌道を繰り返し鑑賞">${icon('loop')}<span>ループ</span></button>
          </div>
        </div>
        <div class="transport-footnote">
          <span id="timeline-help">走行すると、時間バーで軌道を振り返れます。</span>
          <span id="performance-label">WEBGL 2 · PROCEDURAL OBJECTS & SOUND</span>
        </div>
      </footer>
      <div id="loading" class="loading" role="status"><span class="loading-orbit"></span><span>小さな宇宙を、組み立てています。</span></div>
      <div id="fatal" class="fatal" role="alert" hidden><span class="micro">ORBITAL / INITIALIZATION</span><h2>装置を起動できませんでした。</h2><p></p><button type="button" id="reload" class="primary-button">再読み込み</button></div>
      <dialog id="guide" class="guide">
        <button id="close-guide" class="dialog-close" type="button" aria-label="遊び方を閉じる">${icon('close')}</button>
        <span class="micro">A SMALL GUIDE TO YOUR UNIVERSE</span>
        <h2>引力を整えて、<br>星の音を聴く。</h2>
        <p>レンズの位置だけを動かし、星を <strong>01 → 02 → 03</strong> のリングへ順番に通して、受け皿へ導きます。点線と実際の星は、まったく同じ計算から生まれます。</p>
        <div class="guide-controls">
          <span>レンズを動かす</span><span>盤面でドラッグ</span>
          <span>レンズを選ぶ</span><span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> / Tab</span>
          <span>位置を調整する</span><span><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></span>
          <span>さらに細かく調整</span><span><kbd>Shift</kbd> + 矢印キー</span>
          <span>再生 / 一時停止</span><span><kbd>Space</kbd></span>
          <span>配置に戻る / 初期配置</span><span><kbd>Esc</kbd> / <kbd>R</kbd></span>
          <span>ミュート</span><span><kbd>M</kbd></span>
        </div>
        <p class="guide-detail">1回の走行は最大12秒。時間バーは記録の再生なので、逆向きの物理計算はしません。スクラブ中は無音です。配置を変えると時間バーがリセットされ、次の走行は必ず最初から始まります。タブを離れると、再生も音も一時停止します。</p>
        <button id="motion" class="motion-button" type="button" aria-pressed="false"><span class="toggle-track" aria-hidden="true"></span><span>動きを控えめにする</span></button>
        <p class="guide-detail">OSの「視差効果を減らす」設定を尊重します。控えめな設定ではリングの振動・波紋と自動ループを止めます。星の移動はゲームに必要な動きとして残します。</p>
        <details class="environment"><summary>描画環境とパフォーマンス</summary><pre id="environment-info"></pre></details>
        <p class="credits">CRAFTED WITH BABYLON.JS & WEB AUDIO<br>すべての造形と音は、この小さな工房で手続き生成しています。</p>
      </dialog>`;
    this.canvas = required<HTMLCanvasElement>('#instrument', root);
    this.handles = required('#lens-handles', root);
    this.timeline = required<HTMLInputElement>('#timeline', root);
    this.help = required<HTMLDialogElement>('#guide', root);
    this.noteElements = [...root.querySelectorAll<HTMLElement>('.score-note')];
  }

  render(session: WorkshopSession, muted: boolean, hintVisible: boolean, reducedMotion: boolean): void {
    this.root.dataset.phase = session.phase;
    this.root.dataset.stage = session.stage.id;
    const celebrating = session.phase === 'complete' || (session.phase === 'paused' && session.lastOutcome === 'caught');
    this.root.classList.toggle('is-celebrating', celebrating);
    this.root.classList.toggle('reduced-motion', reducedMotion);
    if (this.stageId !== session.stage.id) this.renderStage(session);
    const headline = celebrating ? ['響きが、', 'ひとつに。'] : session.stage.headline;
    const h1 = required('#headline');
    const headlineText = headline.join('\n');
    text(h1, headlineText);
    text(required('#description'), celebrating
      ? '3つの共鳴が、ひとつの軌道に。\n今はただ、星の寄り道を眺めて。'
      : session.stage.description);
    text(required('#chapter-eyebrow'), celebrating ? 'ORBIT COMPLETE' : `STUDY ${String(session.stageIndex + 1).padStart(2, '0')}  /  ${session.stage.title}`);
    const primary = session.isAdvancing ? '一時停止' : session.phase === 'paused' ? '続きから'
      : session.phase === 'complete' ? 'もう一度聴く' : session.phase === 'scrubbing' ? '最初から再生' : '星を放つ';
    if (primary !== this.lastPrimary) {
      required('#play').innerHTML = `${icon(session.isAdvancing ? 'pause' : 'play')}<span>${primary}</span><kbd>Space</kbd>`;
      this.lastPrimary = primary;
    }
    required('#edit').hidden = session.canEdit;
    required<HTMLButtonElement>('#hint').disabled = !session.canEdit;
    text(required('#hint span:last-child'), hintVisible ? 'お手本を置く' : 'ヒント');
    const mute = required<HTMLButtonElement>('#mute');
    const muteLabel = muted ? 'ミュート' : '音あり';
    if (mute.dataset.label !== muteLabel) {
      mute.innerHTML = `${icon(muted ? 'muted' : 'sound')}<span>${muteLabel}</span>`;
      mute.dataset.label = muteLabel;
      mute.setAttribute('aria-pressed', String(muted));
      mute.title = muted ? '音をオン（M）' : 'ミュート（M）';
    }
    required('#loop').setAttribute('aria-pressed', String(session.loop));
    required('#motion').setAttribute('aria-pressed', String(reducedMotion));
    required('#next-stage').hidden = !celebrating;
    text(required('#next-stage span'), session.stageIndex === session.stages.length - 1 ? 'はじめの軌道へ' : '次の軌道へ');
    text(required('#interaction-title'), celebrating ? '星が描いた、小さな完成形。'
      : !session.canEdit ? '再生中は、配置を固定しています' : '真鍮のレンズをドラッグ');
    text(required('#interaction-detail'), hintVisible ? session.stage.hint
      : celebrating ? 'そのまま眺める。あるいは、次の響きへ。'
        : !session.canEdit ? '「配置に戻る」で、すぐに調整できます。' : '点線は、これから生まれる軌道。');
    this.lensHandles.forEach((handle, i) => {
      handle.hidden = !session.canEdit;
      handle.setAttribute('aria-pressed', String(i === session.selectedLens));
    });
    this.root.querySelectorAll<HTMLButtonElement>('.lens-choice').forEach((button, i) => {
      button.disabled = !session.canEdit;
      button.setAttribute('aria-pressed', String(i === session.selectedLens));
    });
    const position = session.placements[session.selectedLens]!;
    text(required('#lens-position'), `LENS ${session.stage.lenses[session.selectedLens]!.label}   X ${position.x.toFixed(2)} / Y ${position.y.toFixed(2)}`);
    this.root.querySelectorAll<HTMLButtonElement>('.stage-tab').forEach((button, i) => {
      button.setAttribute('aria-current', i === session.stageIndex ? 'step' : 'false');
      button.classList.toggle('is-solved', session.completedStages.has(session.stages[i]!.id));
    });
    this.timeline.disabled = !session.recording;
    this.timeline.max = String(session.recording?.duration ?? session.prediction.duration);
    if (this.lastRecording !== session.recording) {
      const markers = required('#timeline-markers');
      markers.replaceChildren();
      session.recording?.events.forEach((event) => {
        if (event.kind !== 'ring') return;
        const marker = document.createElement('span');
        marker.style.left = `${event.time / session.recording!.duration * 100}%`;
        marker.textContent = session.stage.rings[event.index]!.note;
        markers.append(marker);
      });
      this.lastRecording = session.recording;
    }
    text(required('#timeline-help'), session.phase === 'scrubbing'
      ? '記録を無音で再生中。星を放つと、開始時点から再生します。'
      : session.recording ? '時間バーをなぞると、直前の走行を無音で振り返れます。'
        : '走行すると、時間バーで軌道を振り返れます。');
    this.updateTime(session);
  }

  private renderStage(session: WorkshopSession): void {
    this.stageId = session.stage.id;
    this.currentNoteCount = -1;
    text(required('#chapter-subtitle'), session.stage.subtitle);
    this.noteElements.forEach((element, i) => text(required('span', element), session.stage.rings[i]!.note));
    required('#stage-tabs').innerHTML = session.stages.map((stage, i) =>
      `<button class="stage-tab" data-stage="${i}" type="button" aria-label="ステージ${i + 1}：${stage.title}"><span>${String(i + 1).padStart(2, '0')}</span><span>${stage.title}</span></button>`).join('');
    required('#lens-choices').innerHTML = session.stage.lenses.map((lens, i) =>
      `<button type="button" class="lens-choice" data-lens="${i}" aria-label="レンズ${lens.label}を選択" aria-pressed="${i === 0}">${lens.label}</button>`).join('') +
      '<span class="lens-key-hint">選んで、矢印キーでも。</span>';
    this.handles.innerHTML = session.stage.lenses.map((lens, i) =>
      `<button type="button" class="lens-handle" data-lens="${i}" aria-label="盤面のレンズ${lens.label}をドラッグ、または矢印キーで移動" aria-pressed="${i === 0}"><span class="drag-label">LENS ${lens.label}<span>DRAG TO SHAPE</span></span></button>`).join('');
    this.lensHandles = [...this.handles.querySelectorAll<HTMLButtonElement>('.lens-handle')];
  }

  updateTime(session: WorkshopSession): void {
    const time = session.time;
    const duration = session.recording?.duration ?? session.prediction.duration;
    this.timeline.value = String(time);
    this.timeline.style.setProperty('--progress', `${time / duration * 100}%`);
    this.timeline.setAttribute('aria-valuetext', `${time.toFixed(2)}秒 / ${duration.toFixed(2)}秒`);
    const code = required('#timecode');
    const content = `${time.toFixed(2)} / ${duration.toFixed(2)} s`;
    text(code, content);
    const count = session.phase === 'editing' ? session.prediction.ringsPassed
      : ringsAt(session.recording ?? session.prediction, time);
    if (count !== this.currentNoteCount) {
      this.noteElements.forEach((element, i) => element.classList.toggle('is-lit', i < count));
      this.currentNoteCount = count;
    }
    text(required('#route-status'), session.phase === 'editing'
      ? count === 3
        ? `予測 3 / 3 · ${session.prediction.outcome === 'caught' ? '受け皿へ' : '受け皿には未到達'}`
        : `予測 ${count} / 3 の共鳴`
      : session.phase === 'scrubbing' ? `記録 ${count} / 3 の共鳴`
        : session.phase === 'complete' ? 'ORBIT COMPLETE'
          : `${count} / 3 の共鳴`);
  }

  positionHandles(points: readonly Vec2[]): void {
    this.lensHandles.forEach((handle, i) => {
      const point = points[i]!;
      handle.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
    });
  }

  announce(message: string): void {
    text(required('#notice'), message);
  }

  ready(): void {
    required('#loading').hidden = true;
    this.root.classList.add('is-ready');
  }

  fatal(message: string): void {
    required('#loading').hidden = true;
    required('#fatal').hidden = false;
    text(required('#fatal p'), message);
    this.root.classList.add('has-fatal');
  }

  showPerformance(diagnostics: { fps: number; renderWidth: number; renderHeight: number; dpr: number; renderer: string; quality: string; frameMs: number }): void {
    text(required('#performance-label'), `WEBGL 2 · ${diagnostics.fps} FPS · ${diagnostics.quality === 'light' ? 'LIGHT RENDER' : 'HANDCRAFTED IN CODE'}`);
    text(required('#environment-info'),
      `${navigator.userAgent}\n\nRenderer: ${diagnostics.renderer}\nFramebuffer: ${diagnostics.renderWidth} × ${diagnostics.renderHeight}\nDevice pixel ratio: ${diagnostics.dpr}\nRolling mean: ${diagnostics.frameMs} ms / ${diagnostics.fps} fps\nQuality: ${diagnostics.quality}\nPhysics: fixed 120 Hz / 12 seconds maximum\nAssets: procedural geometry, textures and audio; no external assets`);
  }
}
