import './styles.css';
import { STAGES } from './data/stages.ts';
import { WorkshopSession } from './core/session.ts';
import { ResonanceAudio } from './audio/instrument.ts';
import { WorkshopControls } from './input/controls.ts';
import { Instrument } from './render/instrument.ts';
import { required, WorkshopView } from './ui/view.ts';
import type { Vec2 } from './core/types.ts';

const view = new WorkshopView(required('#app'));
required('#reload').addEventListener('click', () => location.reload());

async function boot(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let userReducedMotion = false;
  let reducedMotion = motionPreference.matches;
  const session = new WorkshopSession(STAGES);
  session.loop = !reducedMotion;
  const renderer = new Instrument(view.canvas, reducedMotion);
  const audio = new ResonanceAudio();
  let showHint = false;
  let playIntent = 0;
  let previousTime = performance.now();
  let previousStatsTime = 0;

  const refresh = () => {
    renderer.sync(session, showHint);
    view.render(session, audio.muted, showHint, reducedMotion);
    view.positionHandles(session.placements.map((position) => renderer.project(position)));
  };
  const audioError = (error: unknown) => {
    console.error('ORBITAL audio:', error);
    audio.setMuted(true);
    view.announce(error instanceof Error ? `${error.message} ミュートで続けられます。` : '音を開始できませんでした。ミュートで続けられます。');
    refresh();
  };
  const stopFeedback = () => {
    playIntent++;
    audio.silence();
    renderer.clearPulses();
  };

  const play = async () => {
    if (session.isAdvancing) {
      stopFeedback();
      session.pause();
      refresh();
      return;
    }
    const intent = ++playIntent;
    let audioFailed = false;
    try {
      await audio.activate();
    } catch (error) {
      audioFailed = true;
      audioError(error);
    }
    if (intent !== playIntent || document.hidden) return;
    const starting = session.phase !== 'paused';
    session.play();
    if (starting) audio.strike(48, -0.5, 0.3);
    showHint = false;
    previousTime = performance.now();
    if (!audioFailed) view.announce('');
    refresh();
  };
  const select = (index: number) => {
    if (!session.canEdit) return;
    session.selectLens(index);
    refresh();
  };
  const move = (index: number, position: Vec2) => {
    if (session.moveLens(index, position)) {
      playIntent++;
      renderer.clearPulses();
      audio.adjustment(position.y);
      view.announce('');
      refresh();
    }
  };
  const reset = () => {
    stopFeedback();
    controls.cancel();
    showHint = false;
    session.reset();
    view.announce('初期配置に戻しました。');
    refresh();
  };
  const edit = () => {
    stopFeedback();
    session.edit();
    view.announce('配置を変えて、別の響きを探しましょう。');
    refresh();
  };
  const mute = async () => {
    audio.setMuted(!audio.muted);
    if (!audio.muted && audio.activated) {
      try { await audio.activate(); } catch (error) { audioError(error); }
    }
    refresh();
  };
  const changeStage = (index: number) => {
    stopFeedback();
    controls.cancel();
    showHint = false;
    session.selectStage(index);
    renderer.setStage(session.stage);
    view.announce('');
    refresh();
  };
  const controls = new WorkshopControls(view.canvas, view.handles, session, renderer, {
    select, move, play: () => void play(), reset, mute: () => void mute(), edit,
  });

  required('#play').addEventListener('click', () => void play());
  required('#mute').addEventListener('click', () => void mute());
  required('#reset').addEventListener('click', reset);
  required('#edit').addEventListener('click', edit);
  required('#next-stage').addEventListener('click', () => changeStage((session.stageIndex + 1) % STAGES.length));
  required('#hint').addEventListener('click', () => {
    if (!session.canEdit) return;
    if (showHint) {
      stopFeedback();
      session.applySolution();
      showHint = false;
      view.announce('お手本の配置です。「星を放つ」で、完成する軌道を聴いてみましょう。');
    } else {
      showHint = true;
      view.announce(session.stage.hint);
    }
    refresh();
  });
  required('#loop').addEventListener('click', () => {
    session.loop = !session.loop;
    if (!session.loop && session.phase === 'complete') {
      audio.silence();
      renderer.clearPulses();
    }
    view.announce(session.loop ? '成功した軌道を、繰り返し鑑賞する設定です。' : '自動ループを止めました。再生ボタンで、いつでももう一度聴けます。');
    refresh();
  });
  required('#stage-tabs').addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-stage]') : null;
    if (button) changeStage(Number(button.dataset.stage));
  });
  required('#lens-choices').addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-lens]') : null;
    if (button) select(Number(button.dataset.lens));
  });
  view.handles.addEventListener('focusin', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-lens]') : null;
    if (button) select(Number(button.dataset.lens));
  });
  view.timeline.addEventListener('input', () => {
    if (!session.recording) return;
    stopFeedback();
    controls.cancel();
    session.seek(Number(view.timeline.value));
    view.announce('');
    refresh();
  });
  required('#help-button').addEventListener('click', () => {
    if (session.isAdvancing) {
      stopFeedback();
      session.pause();
      refresh();
    }
    view.showPerformance(renderer.diagnostics());
    view.help.showModal();
  });
  required('#close-guide').addEventListener('click', () => view.help.close());
  view.help.addEventListener('click', (event) => {
    if (event.target === view.help) {
      const rect = view.help.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) view.help.close();
    }
  });
  const updateMotion = () => {
    reducedMotion = motionPreference.matches || userReducedMotion;
    renderer.setReducedMotion(reducedMotion);
    if (reducedMotion) session.loop = false;
    refresh();
  };
  required('#motion').addEventListener('click', () => {
    if (motionPreference.matches) {
      view.announce('OSの「視差効果を減らす」設定を使用しています。');
      return;
    }
    userReducedMotion = !userReducedMotion;
    updateMotion();
  });
  motionPreference.addEventListener('change', updateMotion);
  document.addEventListener('visibilitychange', () => {
    controls.cancel();
    previousTime = performance.now();
    if (document.hidden) {
      stopFeedback();
      const wasPlaying = session.isAdvancing;
      session.pause();
      void audio.suspend().catch(audioError);
      if (wasPlaying) view.announce('タブを離れたため一時停止しました。「続きから」で再開できます。');
      refresh();
    }
  });
  window.addEventListener('resize', () => {
    renderer.resize();
    refresh();
  });
  renderer.engine.onContextLostObservable.add(() => {
    stopFeedback();
    session.pause();
    view.announce('描画が中断されました。WebGLの復旧を待っています。');
    refresh();
  });
  renderer.engine.onContextRestoredObservable.add(() => {
    renderer.resize();
    view.announce('描画が復旧しました。再生ボタンで再開できます。');
    refresh();
  });

  renderer.setStage(session.stage);
  refresh();
  renderer.engine.runRenderLoop(() => {
    if (document.hidden) return;
    const now = performance.now();
    const delta = Math.max(0, (now - previousTime) / 1000);
    previousTime = now;
    const previousPhase = session.phase;
    if (delta > 0.75 && session.isAdvancing) {
      stopFeedback();
      session.pause();
      view.announce('描画がしばらく止まったため、一時停止しました。「続きから」で再開できます。');
    }
    const events = session.advance(delta);
    for (const event of events) {
      renderer.react(event, now / 1000);
      if (event.kind === 'ring') {
        audio.strike(session.stage.rings[event.index]!.midi, event.position.x / 10);
        if (!reducedMotion && typeof navigator.vibrate === 'function') navigator.vibrate(12);
      } else if (event.outcome === 'caught') {
        audio.strike(session.stage.rings[0].midi - 12, 0.25, 0.32);
        view.announce(session.loop ? 'あなたの軌道を、繰り返し演奏しています。' : '3つの共鳴をつなぎ、受け皿に到着しました。');
      } else {
        const count = session.recording!.ringsPassed;
        view.announce(event.outcome === 'timeout'
          ? `12秒が経ちました。${count}つの共鳴を記録。引力を少し整えて、もう一度。`
          : event.outcome === 'incomplete'
            ? '受け皿には届きました。リングを01 → 02 → 03の順につなぎましょう。'
            : count === 3
              ? '3つの共鳴がつながりました。受け皿まで届くよう、もう少しだけ調整を。'
              : `${count}つの共鳴を記録。レンズを少し動かして、もう一度。`);
      }
    }
    if (session.phase !== previousPhase) refresh();
    renderer.render(session, now / 1000, delta);
    view.updateTime(session);
    if (now - previousStatsTime > 1000) {
      view.showPerformance(renderer.diagnostics());
      previousStatsTime = now;
    }
  });
  await renderer.scene.whenReadyAsync();
  view.ready();
  view.announce('01 → 02 → 03 → 受け皿。まずは一度、星を放ってみましょう。');
  window.addEventListener('pagehide', (event) => {
    stopFeedback();
    controls.cancel();
    session.pause();
    if (event.persisted) {
      void audio.suspend().catch(audioError);
    } else {
      controls.dispose();
      renderer.dispose();
      void audio.dispose().catch((error: unknown) => console.error('ORBITAL audio cleanup:', error));
    }
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    previousTime = performance.now();
    renderer.resize();
    view.announce('装置に戻りました。再生ボタンで続きから再開できます。');
    refresh();
  });

  if (import.meta.env.DEV) {
    window.__ORBITAL__ = {
      snapshot: () => ({
        phase: session.phase, stage: session.stage.id, time: session.time,
        placements: session.placements.map((position) => ({ ...position })),
        predictedOutcome: session.prediction.outcome, predictedRings: session.prediction.ringsPassed,
        predictedDuration: session.prediction.duration, recordedDuration: session.recording?.duration ?? null,
        lastOutcome: session.lastOutcome, loop: session.loop, reducedMotion,
        completedStages: [...session.completedStages],
        audio: { muted: audio.muted, activated: audio.activated, state: audio.state, notesPlayed: audio.notesPlayed, peak: audio.peak },
      }),
      diagnostics: () => renderer.diagnostics(),
      lensScreens: () => session.placements.map((position) => renderer.project(position)),
      solutionScreens: () => session.stage.lenses.map((lens) => renderer.project(lens.solution)),
    };
  }
}

declare global {
  interface Window {
    __ORBITAL__?: {
      snapshot: () => {
        phase: string; stage: string; time: number; placements: Vec2[]; predictedOutcome: string;
        predictedRings: number; predictedDuration: number; recordedDuration: number | null;
        lastOutcome: string | null; loop: boolean; reducedMotion: boolean; completedStages: string[];
        audio: { muted: boolean; activated: boolean; state: string; notesPlayed: number; peak: number };
      };
      diagnostics: () => {
        fps: number; frameMs: number; renderWidth: number; renderHeight: number; dpr: number;
        webgl: number; renderer: string; quality: string; meshes: number; materials: number; textures: number; ready: boolean; predictionVertices: number;
      };
      lensScreens: () => Vec2[];
      solutionScreens: () => Vec2[];
    };
  }
}

void boot().catch((error: unknown) => {
  console.error('ORBITAL initialization:', error);
  view.fatal(error instanceof Error ? error.message : '初期化に失敗しました。ブラウザーを更新して再度お試しください。');
});
