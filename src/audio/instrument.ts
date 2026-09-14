export class ResonanceAudio {
  muted = false;
  activated = false;
  notesPlayed = 0;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private analyser: AnalyserNode | null = null;
  private waveform = new Float32Array(256);
  private impulse: AudioBuffer | null = null;
  private oscillators = new Set<OscillatorNode>();
  private lastAdjustment = -Infinity;

  async activate(): Promise<void> {
    this.activated = true;
    if (this.muted) return;
    if (!this.context) {
      const AudioContextClass = window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error('このブラウザーではWeb Audioを利用できません。音なしで遊べます。');
      this.context = new AudioContextClass({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = 0.4;
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      this.master.connect(compressor);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      compressor.connect(this.analyser);
      this.analyser.connect(this.context.destination);
      this.reverb = this.context.createConvolver();
      this.impulse = this.createImpulse(this.context);
      this.reverb.buffer = this.impulse;
      const wet = this.context.createGain();
      wet.gain.value = 0.22;
      this.reverb.connect(wet);
      wet.connect(this.master);
    }
    if (this.context.state !== 'running') await this.context.resume();
    this.restoreVolume();
  }

  private createImpulse(context: AudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * 1.6);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    let seed = 71893;
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        samples[i] = ((seed >>> 0) / 0xffffffff * 2 - 1) * Math.pow(1 - i / length, 2.8);
      }
    }
    return buffer;
  }

  strike(midi: number, pan: number, strength = 1): void {
    if (this.muted || !this.context || !this.master || this.context.state !== 'running') return;
    this.restoreVolume();
    const now = this.context.currentTime;
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const panner = this.context.createStereoPanner();
    panner.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    panner.connect(this.master);
    if (this.reverb) panner.connect(this.reverb);
    const partials = [
      { ratio: 1, gain: 0.42, length: 1.75 },
      { ratio: 2.002, gain: 0.12, length: 0.9 },
      { ratio: 3.997, gain: 0.035, length: 0.42 },
    ];
    let remaining = partials.length;
    for (const partial of partials) {
      const oscillator = this.context.createOscillator();
      const envelope = this.context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency * partial.ratio;
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(partial.gain * strength, now + 0.009);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + partial.length);
      oscillator.connect(envelope);
      envelope.connect(panner);
      this.oscillators.add(oscillator);
      oscillator.onended = () => {
        this.oscillators.delete(oscillator);
        oscillator.disconnect();
        envelope.disconnect();
        remaining--;
        if (remaining === 0) panner.disconnect();
      };
      oscillator.start(now);
      oscillator.stop(now + partial.length + 0.03);
    }
    this.notesPlayed++;
  }

  adjustment(y: number): void {
    const now = performance.now();
    if (now - this.lastAdjustment < 140 || !this.activated) return;
    this.lastAdjustment = now;
    this.strike(48 + Math.round(y * 0.6), 0, 0.08);
  }

  setMuted(value: boolean): void {
    this.muted = value;
    if (value) this.silence();
    else this.restoreVolume();
  }

  private restoreVolume(): void {
    if (!this.master || !this.context || this.muted) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0.4, now, 0.008);
  }

  silence(): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0, now);
    for (const oscillator of this.oscillators) oscillator.stop(now);
    this.oscillators.clear();
    if (this.reverb) this.reverb.buffer = this.impulse;
  }

  async suspend(): Promise<void> {
    this.silence();
    if (this.context?.state === 'running') await this.context.suspend();
  }

  get state(): string {
    return this.context?.state ?? 'not-started';
  }

  get peak(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.waveform);
    return this.waveform.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
  }

  async dispose(): Promise<void> {
    this.silence();
    if (this.context && this.context.state !== 'closed') await this.context.close();
  }
}
