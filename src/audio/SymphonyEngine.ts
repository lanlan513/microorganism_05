// 微观交响 · Web Audio 演奏引擎（纯手写，不依赖任何音频库）
//
// 只负责照服务端下发的总谱（VoicePlan/事件序列）发声，绝不推导参数。
//
// 三个必须做对的点：
//  A. 自动播放策略：AudioContext 只能在用户手势中创建/resume。
//     play() 必须由点击直接调用；首次调用若仍被策略拦截，返回 'blocked'，
//     UI 显示"点按出声"遮罩，等待下一次手势。
//  B. 替代反馈：系统静音 / 用户静音 / 减弱动态时，通过 onNote 回调驱动视觉
//     与触觉（navigator.vibrate），且引擎在无声状态下调度照跑（以时钟推进）。
//  C. Context 随时可能被系统挂起（锁屏、切后台、来电）：
//     监听 'statechange' + 每次调度 tick 检查 ctx.state，挂起后暂停推进游标，
//     resume() 在手势中重新调用并等到 state==='running' 才继续；
//     调度一律以 ctx.currentTime 为基准，事件游标永不重复发声。

import type { SymphonyNoteEvent, SymphonyPlan, VoicePlan } from '../../shared/symphony';
import { midiToFreq } from '../../shared/derive';
import { hapticTap } from './capabilities';

export type EngineStatus =
  | 'idle' // 未加载
  | 'suspended' // 已就绪但 AudioContext 被系统/自动播放策略挂起
  | 'running' // 正在播放
  | 'paused' // 用户主动暂停
  | 'muted' // 用户主动静音（调度照跑，仅不出声）
  | 'unsupported'; // 没有 Web Audio，完全靠视觉/触觉反馈

export interface NoteCallbackInfo {
  microbeId: number;
  downbeat: boolean;
  tension: number;
  velocity: number;
}

export interface EngineCallbacks {
  onStatus?: (status: EngineStatus) => void;
  onStep?: (step: number) => void; // 当前十六分步 0..steps-1
  onNote?: (info: NoteCallbackInfo) => void; // 每触发一个音（静音也触发 → 替代反馈）
  onLoop?: (loopIndex: number) => void;
}

const LOOKAHEAD_SEC = 0.12; // 提前调度窗口
const TICK_MS = 25; // 调度器心跳

interface ScheduledEvent extends SymphonyNoteEvent {
  microbeId: number;
  voice: VoicePlan;
}

export class SymphonyEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private plan: SymphonyPlan | null = null;
  private events: ScheduledEvent[] = [];
  private cursor = 0; // 下一个待发声事件下标（单调递增，保证不重复、不丢失）
  private loopIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private status: EngineStatus = 'idle';
  private muted = false;
  /** 用户主动暂停（区别于系统挂起），visibilitychange 时不得自动恢复 */
  private userPaused = false;
  /** 当前循环起点在 ctx 时间轴上的绝对时间；事件调度时间 = loopStart + ev.time */
  private loopStart = 0;
  private fallbackStart = 0; // 当前循环起点的 performance.now
  private fallbackElapsed = 0; // 暂停前已累计的秒数
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private fallbackStep = 0;
  private fallbackCursor = 0; // 已触发到的事件下标（含跨循环）
  private cb: EngineCallbacks;
  private readonly boundStateChange = () => this.handleStateChange();
  private readonly boundVisibility = () => this.handleVisibility();

  constructor(cb: EngineCallbacks = {}) {
    this.cb = cb;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.boundVisibility);
    }
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  isMuted(): boolean {
    return this.muted;
  }

  // -------------------------------------------------------------------------
  // 加载总谱：完全不创建 AudioContext（必须等首次手势，见 play）
  // -------------------------------------------------------------------------
  load(plan: SymphonyPlan, autoplay = false) {
    this.stopInternal(false);
    this.plan = plan;
    this.events = [];
    for (const microbeId of plan.order) {
      const voice = plan.voices.find((v) => v.microbeId === microbeId);
      if (!voice) continue;
      for (const ev of plan.events[microbeId] ?? []) {
        this.events.push({ ...ev, microbeId, voice });
      }
    }
    // 按时间排序；同拍的重拍和声在前，听感更稳
    this.events.sort((a, b) => a.time - b.time || Number(b.downbeat) - Number(a.downbeat));
    this.cursor = 0;
    this.loopIndex = 0;
    this.userPaused = false;
    this.fallbackElapsed = 0;
    this.fallbackStep = 0;
    this.fallbackCursor = 0;

    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (typeof Ctx !== 'function') {
      if (autoplay) this.startFallback(); // 本就无声模式，直接"演奏"
      else this.setStatus('unsupported');
      return;
    }
    if (autoplay && this.ctx?.state === 'running') {
      // 此前已由用户手势解锁：换谱后直接续播，不再要求点击
      this.resumeFromCursor(0.05);
    } else {
      this.setStatus('suspended');
    }
  }

  // -------------------------------------------------------------------------
  // 首次/再次出声：必须在用户手势的调用栈里执行
  // 返回 true 表示成功；false 表示仍被自动播放策略拦截，UI 要继续等手势。
  // -------------------------------------------------------------------------
  async play(): Promise<boolean> {
    if (!this.plan) return false;

    // 无 Web Audio：用纯视觉/触觉模式"演奏"
    if (this.status === 'unsupported' || !this.createContext()) {
      this.startFallback();
      return true;
    }

    // 关键：每次都尝试 resume，且等待它真正进入 running。
    // iOS Safari 在手势外调用会保持 suspended，手势内一般能解锁。
    try {
      if (this.ctx!.state !== 'running') {
        await this.ctx!.resume();
      }
    } catch {
      // resume 被拒：保留 suspended，由 UI 引导再次点击
    }
    if (this.ctx!.state !== 'running') {
      this.setStatus('suspended');
      return false;
    }

    this.userPaused = false;
    this.resumeFromCursor(0.05);
    return true;
  }

  /** 用户主动暂停（与系统挂起区分开） */
  pause() {
    if (this.status === 'unsupported') {
      // 记录已播放时长，恢复时延续同一时间轴
      if (this.fallbackTimer) {
        this.fallbackElapsed += (performance.now() - this.fallbackStart) / 1000;
      }
      this.stopFallback();
      this.userPaused = true;
      this.setStatus('paused');
      return;
    }
    if (!this.ctx || (this.status !== 'running' && this.status !== 'muted')) return;
    this.userPaused = true;
    this.stopScheduler();
    // 主动把 ctx 挂起，省电；下次 play 在手势中 resume
    void this.ctx.suspend();
    this.setStatus('paused');
  }

  stop() {
    this.stopInternal(true);
  }

  /** 用户静音开关：静音时调度照跑，onNote 照触发，只是不发声 → 视觉/触觉替代反馈不断 */
  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
    if (this.status === 'running' || this.status === 'muted') {
      this.setStatus(muted ? 'muted' : 'running');
    }
  }

  destroy() {
    this.stopInternal(true);
    document.removeEventListener('visibilitychange', this.boundVisibility);
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  // -------------------------------------------------------------------------
  // 内部：AudioContext 生命周期
  // -------------------------------------------------------------------------
  private createContext(): boolean {
    if (this.ctx) return true;
    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (typeof Ctx !== 'function') {
      this.setStatus('unsupported');
      return false;
    }
    this.ctx = new Ctx();
    // master(静音控制) → tanh 式软压（compressor 防爆音）→ destination
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -10;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;
    this.master.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);
    this.ctx.addEventListener('statechange', this.boundStateChange);
    return true;
  }

  /** 系统层面的挂起/恢复（锁屏、来电、iOS 自动挂起） */
  private handleStateChange() {
    if (!this.ctx || !this.plan) return;
    if (this.ctx.state === 'suspended' && (this.status === 'running' || this.status === 'muted')) {
      // 被系统挂起：停调度器但保留 cursor（不丢任何音），恢复后从下一个未发音续播
      this.stopScheduler();
      this.setStatus('suspended');
    }
  }

  /** 切回页面时主动尝试恢复；若仍被拦截，保持 suspended 等用户手势（play 按钮） */
  private handleVisibility() {
    if (
      document.visibilityState === 'visible'
      && this.status === 'suspended'
      && !this.userPaused
      && this.ctx
    ) {
      void this.ctx.resume().then(() => {
        // 仅当挂起发生在"播放中"（非用户主动暂停）才自动续播
        if (this.ctx?.state === 'running' && this.status === 'suspended' && !this.userPaused && this.plan) {
          this.resumeFromCursor(0.05);
        }
      });
    }
  }

  /** 把循环起点对齐到"下一个未发音事件"，并重启调度器 */
  private resumeFromCursor(delaySec: number) {
    if (!this.ctx || !this.plan) return;
    const within = this.cursor < this.events.length ? this.events[this.cursor].time : 0;
    this.loopStart = this.ctx.currentTime + delaySec - within;
    this.startScheduler();
    this.setStatus(this.muted ? 'muted' : 'running');
  }

  // -------------------------------------------------------------------------
  // 调度器：以 ctx.currentTime 为唯一时钟，cursor 单调推进
  // -------------------------------------------------------------------------
  private startScheduler() {
    if (this.timer) return;
    this.timer = setInterval(() => this.scheduleTick(), TICK_MS);
    this.scheduleTick();
  }

  private stopScheduler() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private scheduleTick() {
    if (!this.ctx || !this.plan) return;
    // 系统在 tick 间隙把 context 挂起：statechange 通常已处理，这里再加一道保险
    if (this.ctx.state !== 'running') {
      if (this.status === 'running' || this.status === 'muted') {
        this.stopScheduler();
        this.setStatus('suspended');
      }
      return;
    }

    const horizon = this.ctx.currentTime + LOOKAHEAD_SEC;
    const loop = this.plan.loopDuration;

    // cursor 指向的事件时间 = 本循环基准 + ev.time；
    // cursor 越界就翻到下一循环，loopStart 整体平移一个循环，音符不重不漏。
    while (true) {
      if (this.cursor >= this.events.length) {
        this.cursor = 0;
        this.loopIndex += 1;
        this.loopStart += loop;
        this.cb.onLoop?.(this.loopIndex);
      }
      const ev = this.events[this.cursor];
      const evTime = this.loopStart + ev.time;
      if (evTime > horizon) break;
      this.triggerEvent(ev, evTime);
      this.cursor += 1;
    }

    // 步进指示：根据当前时间反推十六分步
    const within = this.ctx.currentTime - this.loopStart;
    const step = Math.min(
      this.plan.steps - 1,
      Math.max(0, Math.floor((within / loop) * this.plan.steps)),
    );
    this.cb.onStep?.(step);
  }

  private triggerEvent(ev: ScheduledEvent, when: number) {
    const { voice } = ev;

    // 发声（静音时跳过节点创建，但回调照走）
    if (!this.muted && this.ctx && this.master) {
      ev.midi.forEach((midi, idx) => {
        this.scheduleNote(voice, midiToFreq(midi), when, ev.duration, ev.velocity, idx > 0);
      });
    }

    // —— 替代反馈通道：无论是否出声都触发 ——
    this.cb.onNote?.({
      microbeId: voice.microbeId,
      downbeat: ev.downbeat,
      tension: voice.tension,
      velocity: ev.velocity,
    });
    if (ev.downbeat) {
      // 轻微触觉：致病性越高脉冲越紧；静音时加重脉冲作为"听到重拍"的替代
      if (this.muted) hapticTap(18);
      else if (voice.tension > 0.66) hapticTap([10, 25, 10]);
      else hapticTap(8);
    }
  }

  private scheduleNote(
    voice: VoicePlan,
    freq: number,
    when: number,
    duration: number,
    velocity: number,
    isChordLayer: boolean,
  ) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = voice.waveform;
    osc.frequency.value = freq;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = voice.cutoffHz;
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = voice.pan * 2 - 1;

    // 包络与 renderWav.ts 对齐：8ms 起音、致病性越高衰减越快、20ms 释放
    const layerScale = isChordLayer ? 0.6 : 1;
    const peak = velocity * voice.level * layerScale;
    const decay = 1.4 - voice.tension * 1.05;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), when + 0.008);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, peak * Math.exp(-duration / decay)),
      when + Math.max(0.03, duration - 0.02),
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.master!);
    osc.start(when);
    osc.stop(when + duration + 0.05);
    osc.onended = () => {
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
  }

  // -------------------------------------------------------------------------
  // 无 Web Audio 降级：纯时钟驱动 onStep/onNote（视觉 + 触觉"无声演奏"）
  // -------------------------------------------------------------------------
  private startFallback() {
    if (this.fallbackTimer) return;
    this.fallbackStart = performance.now();
    this.setStatus(this.muted ? 'muted' : 'running');
    this.fallbackTimer = setInterval(() => this.fallbackTick(), TICK_MS);
  }

  private stopFallback() {
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  private fallbackTick() {
    if (!this.plan) return;
    const elapsed = this.fallbackElapsed + (performance.now() - this.fallbackStart) / 1000;
    const loop = this.plan.loopDuration;
    const loopIndex = Math.floor(elapsed / loop);
    const within = elapsed % loop;
    const step = Math.floor((within / loop) * this.plan.steps);
    if (step !== this.fallbackStep) {
      this.fallbackStep = step;
      this.cb.onStep?.(step);
    }
    // 绝对游标 → (循环, 事件下标)，保证暂停/循环都不漏不重
    while (this.fallbackCursor < (loopIndex + 1) * this.events.length) {
      const evLoop = Math.floor(this.fallbackCursor / this.events.length);
      const evIdx = this.fallbackCursor % this.events.length;
      const evTime = evLoop * loop + this.events[evIdx].time;
      if (evTime > elapsed) break;
      const ev = this.events[evIdx];
      this.cb.onNote?.({
        microbeId: ev.microbeId,
        downbeat: ev.downbeat,
        tension: ev.voice.tension,
        velocity: ev.velocity,
      });
      if (ev.downbeat) hapticTap(16);
      this.fallbackCursor += 1;
    }
    if (loopIndex !== this.loopIndex) {
      this.loopIndex = loopIndex;
      this.cb.onLoop?.(loopIndex);
    }
  }

  private stopInternal(notify: boolean) {
    this.stopScheduler();
    this.stopFallback();
    this.cursor = 0;
    this.loopIndex = 0;
    this.loopStart = 0;
    this.fallbackElapsed = 0;
    this.fallbackStep = 0;
    this.fallbackCursor = 0;
    if (notify) this.setStatus(this.ctx ? 'suspended' : this.plan ? 'unsupported' : 'idle');
  }

  private setStatus(s: EngineStatus) {
    if (this.status === s) return;
    this.status = s;
    this.cb.onStatus?.(s);
  }
}
