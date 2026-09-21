import type { AudioParams, SymphonyTransport } from '../../shared/types';

export interface EngineVoice {
  id: number;
  name: string;
  audio: AudioParams;
}

export type EngineContextState = 'uncreated' | 'suspended' | 'interrupted' | 'running' | 'closed';

interface EngineEvents {
  /** AudioContext 状态变化（含被系统挂起） */
  state: { state: EngineContextState };
  /** 播放/停止 */
  playstate: { playing: boolean };
  /** 每个 16 分步触发一次（用于视觉反馈，静音时也照常触发） */
  step: { step: number };
}

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * 微观交响播放引擎 —— 纯 Web Audio 手写合成，不依赖任何音频库。
 *
 * 三个必须正确处理的问题：
 * 1. 自动播放策略：AudioContext 懒创建，且只在用户手势里 resume（unlock()）。
 * 2. 静音/减弱动态时调度器照常运行，视觉反馈不中断（静音只把主增益拉到 0）。
 * 3. AudioContext 随时可能被系统挂起（切后台、来电、系统策略）：
 *    监听 statechange / visibilitychange / pageshow，恢复时把调度指针
 *    重新对齐到"现在"，绝不补播积压的音符。
 */
class SymphonyEngine {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null; // 停止时快速淡出的总线
  private master: GainNode | null = null; // 静音控制
  private voices: EngineVoice[] = [];
  private transport: SymphonyTransport = { bpm: 96, stepsPerBar: 16, bars: 4 };
  private stepDur = 60 / 96 / 4;
  private playing = false;
  private muted = false;
  private currentStep = 0;
  private nextStepTime = 0;
  private readonly lookahead = 0.12;
  private timer: number | null = null;
  private stepTimers: number[] = [];
  private activeSources = new Set<AudioScheduledSourceNode>();
  private listeners: { [K in keyof EngineEvents]: Set<(d: EngineEvents[K]) => void> } = {
    state: new Set(),
    playstate: new Set(),
    step: new Set(),
  };

  get supported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) ===
        'function'
    );
  }

  get state(): EngineContextState {
    return this.ctx ? (this.ctx.state as EngineContextState) : 'uncreated';
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  on<K extends keyof EngineEvents>(type: K, fn: (d: EngineEvents[K]) => void): () => void {
    this.listeners[type].add(fn);
    return () => this.listeners[type].delete(fn);
  }

  private emit<K extends keyof EngineEvents>(type: K, detail: EngineEvents[K]): void {
    this.listeners[type].forEach((fn) => fn(detail));
  }

  private ensureContext(): AudioContext | null {
    if (!this.supported) return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        this.ctx = new AC(); // 旧版 Safari 不接受构造参数
      }
      this.bus = this.ctx.createGain();
      this.master = this.ctx.createGain();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      this.bus.connect(this.master);
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      this.ctx.addEventListener('statechange', this.handleStateChange);
      document.addEventListener('visibilitychange', this.handleVisibility);
      window.addEventListener('pageshow', this.handlePageShow);
    }
    return this.ctx;
  }

  /**
   * 解锁音频。必须在用户手势（点击/触摸/按键）里调用 ——
   * 移动端自动播放策略没有别的绕法。
   */
  async unlock(): Promise<EngineContextState> {
    const ctx = this.ensureContext();
    if (!ctx) return 'uncreated';
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        // 忽略：statechange 监听与恢复横幅会兜底
      }
    }
    this.emit('state', { state: this.state });
    return this.state;
  }

  setTransport(t: SymphonyTransport): void {
    this.transport = t;
    this.stepDur = 60 / t.bpm / 4;
  }

  setVoices(voices: EngineVoice[]): void {
    this.voices = voices;
  }

  /** 开始循环播放当前交响（调用前确保已 unlock） */
  start(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.playing || this.voices.length === 0) return;
    if (this.bus) {
      // 若上一次停止的淡出还没结束，先把总线拉回
      const t = ctx.currentTime;
      this.bus.gain.cancelScheduledValues(t);
      this.bus.gain.setValueAtTime(1, t);
    }
    this.playing = true;
    this.currentStep = 0;
    this.nextStepTime = ctx.currentTime + 0.08;
    this.timer = window.setInterval(this.tick, 25);
    this.emit('playstate', { playing: true });
  }

  /** 停止：总线快速淡出，截断余音，再复位总线增益 */
  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.stepTimers.forEach((t) => window.clearTimeout(t));
    this.stepTimers = [];
    const ctx = this.ctx;
    if (ctx && this.bus) {
      const t = ctx.currentTime;
      this.bus.gain.cancelScheduledValues(t);
      this.bus.gain.setValueAtTime(this.bus.gain.value, t);
      this.bus.gain.linearRampToValueAtTime(0.0001, t + 0.08);
      window.setTimeout(() => {
        this.activeSources.forEach((s) => {
          try {
            s.stop();
          } catch {
            // 已自然结束的源无需处理
          }
        });
        if (this.ctx && this.bus) {
          this.bus.gain.setValueAtTime(1, this.ctx.currentTime);
        }
      }, 120);
    }
    this.emit('playstate', { playing: false });
  }

  /**
   * 静音只关主增益，调度器继续走 ——
   * 静音时视觉反馈（步进高亮、状态行）不中断，这就是替代反馈。
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(muted ? 0 : 1, t + 0.03);
    }
  }

  /** 单条标本试听：播一小节它的节奏型 */
  preview(voice: EngineVoice): void {
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;
    const startAt = ctx.currentTime + 0.05;
    for (let s = 0; s < this.transport.stepsPerBar; s++) {
      if (voice.audio.rhythm.steps[s]) {
        this.scheduleVoice(voice, startAt + s * this.stepDur);
      }
    }
  }

  /** 前瞻调度：每 25ms 把未来 120ms 内的步进排上音频时钟 */
  private tick = (): void => {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return; // 被系统挂起：原地等待，不推进
    if (this.nextStepTime < ctx.currentTime - 0.05) {
      // 时钟被挂起后恢复：丢弃积压，重新对齐到"现在"
      this.nextStepTime = ctx.currentTime + 0.05;
    }
    while (this.nextStepTime < ctx.currentTime + this.lookahead) {
      const step = this.currentStep;
      const when = this.nextStepTime;
      for (const voice of this.voices) {
        if (voice.audio.rhythm.steps[step]) this.scheduleVoice(voice, when);
      }
      const delay = Math.max(0, (when - ctx.currentTime) * 1000);
      this.stepTimers.push(
        window.setTimeout(() => this.emit('step', { step }), delay),
      );
      this.nextStepTime += this.stepDur;
      this.currentStep = (this.currentStep + 1) % this.transport.stepsPerBar;
    }
  };

  /** 一个声部在一个步进上的发声：和声音程 ×（锯齿 → 低通 → 包络） */
  private scheduleVoice(voice: EngineVoice, when: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    const p = voice.audio;
    for (const interval of p.harmony.intervals) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFreq(p.midi + interval);
      if (interval !== 0 && p.harmony.detuneCents) {
        osc.detune.value = p.harmony.detuneCents;
      }
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = p.cutoffHz;
      filter.Q.value = 0.8;
      const env = ctx.createGain();
      const peak = 0.16 / p.harmony.intervals.length;
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(peak, when + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, when + p.decaySeconds);
      osc.connect(filter);
      filter.connect(env);
      env.connect(this.bus);
      osc.start(when);
      osc.stop(when + p.decaySeconds + 0.05);
      this.activeSources.add(osc);
      osc.onended = () => {
        this.activeSources.delete(osc);
        osc.disconnect();
        filter.disconnect();
        env.disconnect();
      };
    }
  }

  private handleStateChange = (): void => {
    if (this.ctx?.state === 'running' && this.playing) {
      // 从挂起恢复：调度指针若落在过去，拉回"现在"，避免补播
      if (this.nextStepTime < this.ctx.currentTime + 0.03) {
        this.nextStepTime = this.ctx.currentTime + 0.06;
      }
    }
    this.emit('state', { state: this.state });
  };

  private resumeIfNeeded = (): void => {
    if (this.playing && this.ctx && this.ctx.state !== 'running') {
      // 页面回到前台：尝试恢复；若浏览器要求手势，恢复横幅会提示用户
      this.ctx.resume().catch(() => {});
    }
  };

  private handleVisibility = (): void => {
    if (document.visibilityState === 'visible') this.resumeIfNeeded();
  };

  private handlePageShow = (): void => {
    this.resumeIfNeeded();
  };
}

export const symphonyEngine = new SymphonyEngine();
