import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Play,
  Square,
  Volume2,
  VolumeX,
  Share2,
  Download,
  Trash2,
  X,
  Music,
  Ear,
  Loader2,
  AudioLines,
} from 'lucide-react';
import { useSymphonyStore, MAX_LAYERS } from '../store/useSymphonyStore';
import { symphonyEngine, type EngineContextState } from '../audio/engine';
import { StepVisualizer } from '../components/symphony/StepVisualizer';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { api } from '../utils/api';
import { noteName, formatSize } from '../utils/music';
import {
  CATEGORY_LABELS,
  METABOLISM_LABELS,
  PATHOGENICITY_LABELS,
  type SymphonyVoice,
} from '../../shared/types';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function SymphonyPage() {
  const {
    voices,
    transport,
    composition,
    loading,
    error,
    fetchParams,
    toggle,
    remove,
    setComposition,
    clear,
  } = useSymphonyStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const reducedMotion = useReducedMotion();

  const [unlocked, setUnlocked] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [ctxState, setCtxState] = useState<EngineContextState>('uncreated');
  const [currentStep, setCurrentStep] = useState(-1);
  const [toast, setToast] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [downloadState, setDownloadState] = useState<'idle' | 'queued' | 'processing'>('idle');
  const [queuePos, setQueuePos] = useState(0);
  const appliedShareRef = useRef<string | null>(null);

  const compositionVoices = useMemo(
    () =>
      composition
        .map((id) => voices.find((v) => v.microbe.id === id))
        .filter((v): v is SymphonyVoice => Boolean(v)),
    [composition, voices],
  );

  const showToast = useCallback((msg: string) => setToast(msg), []);

  /* ---------- 数据 ---------- */

  useEffect(() => {
    fetchParams();
  }, [fetchParams]);

  // 分享链接：/symphony?c=1.5.9 —— 链接里只有 id，参数重新向服务端取，保证听到同一段
  useEffect(() => {
    const c = searchParams.get('c');
    if (!c || voices.length === 0 || appliedShareRef.current === c) return;
    appliedShareRef.current = c;
    const ids = c.split('.').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    setComposition(ids);
    if (ids.length > 0) {
      showToast(`已载入分享的微观交响（${ids.length} 条标本），点「播放」聆听`);
      setAnnouncement(`已载入分享的微观交响，共 ${ids.length} 条标本`);
    }
  }, [searchParams, voices, setComposition, showToast]);

  /* ---------- 引擎接线 ---------- */

  useEffect(() => {
    const offState = symphonyEngine.on('state', ({ state }) => setCtxState(state));
    const offPlay = symphonyEngine.on('playstate', ({ playing: p }) => {
      setPlaying(p);
      if (!p) setCurrentStep(-1);
    });
    const offStep = symphonyEngine.on('step', ({ step }) => setCurrentStep(step));
    return () => {
      offState();
      offPlay();
      offStep();
    };
  }, []);

  useEffect(() => {
    if (transport) symphonyEngine.setTransport(transport);
  }, [transport]);

  useEffect(() => {
    symphonyEngine.setVoices(
      compositionVoices.map((v) => ({ id: v.microbe.id, name: v.microbe.name, audio: v.audio })),
    );
  }, [compositionVoices]);

  // 离开页面时停止发声
  useEffect(() => () => symphonyEngine.stop(), []);

  // 清空交响时自动停止
  useEffect(() => {
    if (composition.length === 0 && playing) symphonyEngine.stop();
  }, [composition.length, playing]);

  // Toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  /* ---------- 交互 ---------- */

  // 自动播放策略：第一次用户交互才允许创建/恢复 AudioContext
  const handleUnlock = useCallback(async () => {
    if (!symphonyEngine.supported) {
      setUnsupported(true);
      return;
    }
    const state = await symphonyEngine.unlock();
    if (state === 'running') {
      setUnlocked(true);
      setAnnouncement('声音已开启');
    }
  }, []);

  const handleToggle = useCallback(
    (voice: SymphonyVoice) => {
      const id = voice.microbe.id;
      const wasIn = composition.includes(id);
      if (!wasIn && composition.length >= MAX_LAYERS) {
        showToast(`最多叠加 ${MAX_LAYERS} 条标本，先移除一条`);
        return;
      }
      toggle(id);
      if (!wasIn) {
        // 点任意一条标本就能听见它：加入的同时试听一小节
        symphonyEngine.preview({ id, name: voice.microbe.name, audio: voice.audio });
      }
    },
    [composition, toggle, showToast],
  );

  const handlePlay = useCallback(async () => {
    await symphonyEngine.unlock(); // 手势内调用，顺便兜底恢复
    symphonyEngine.start();
  }, []);

  const handleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      symphonyEngine.setMuted(next);
      setAnnouncement(next ? '已静音，节奏与声部以视觉方式继续反馈' : '已取消静音');
      return next;
    });
  }, []);

  const handleShare = useCallback(async () => {
    const c = composition.join('.');
    const url = `${window.location.origin}/symphony?c=${c}`;
    const ok = await copyText(url);
    showToast(ok ? '分享链接已复制，任何人打开听到的都是同一段' : `请手动复制：${url}`);
    setSearchParams({ c }, { replace: true });
  }, [composition, setSearchParams, showToast]);

  const handleDownload = useCallback(async () => {
    if (downloadState !== 'idle') return;
    setDownloadState('queued');
    try {
      const { jobId } = await api.createSymphonyRender(composition);
      // 轮询服务端任务队列
      let fileUrl: string | undefined;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 700));
        const job = await api.getSymphonyRender(jobId);
        if (job.status === 'queued') {
          setQueuePos(job.position);
        } else if (job.status === 'processing') {
          setDownloadState('processing');
        } else if (job.status === 'done') {
          fileUrl = job.fileUrl;
          break;
        } else {
          throw new Error(job.error || '渲染失败');
        }
      }
      if (!fileUrl) throw new Error('渲染超时，请重试');
      const a = document.createElement('a');
      a.href = fileUrl;
      a.download = `微观交响-${jobId}.wav`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast('WAV 已开始下载（服务端渲染，与试听同一份参数）');
    } catch (err) {
      showToast(`下载失败：${(err as Error).message}`);
    } finally {
      setDownloadState('idle');
      setQueuePos(0);
    }
  }, [composition, downloadState, showToast]);

  /* ---------- 渲染 ---------- */

  const empty = composition.length === 0;
  const suspended = unlocked && playing && ctxState !== 'running';
  const beat = currentStep >= 0 ? Math.floor(currentStep / 4) + 1 : 0;

  return (
    <div className="relative min-h-screen pt-28 pb-24">
      {/* 首次交互前：自动播放策略要求的手势解锁层 */}
      {!unlocked && (
        <div
          className="unlock-overlay"
          role="button"
          tabIndex={0}
          aria-label="开启声音"
          onPointerDown={handleUnlock}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleUnlock();
          }}
        >
          <div className="glass-card glow-border max-w-sm mx-6 p-10 text-center">
            <Ear className="w-10 h-10 mx-auto mb-5 text-glow-primary" aria-hidden="true" />
            {unsupported ? (
              <>
                <p className="font-mono text-sm text-glow-red mb-5">
                  当前浏览器不支持 Web Audio，无法播放声音
                </p>
                <button
                  className="btn-primary-ghost px-5 py-2 text-sm"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setUnlocked(true)}
                >
                  继续浏览（无声）
                </button>
              </>
            ) : (
              <>
                <p className="font-display text-2xl text-text-light mb-3">轻触任意处，开启声音</p>
                <p className="font-mono text-xs text-text-muted leading-relaxed">
                  浏览器的自动播放策略要求
                  <br />
                  第一次交互之后才允许出声
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* AudioContext 被系统挂起时的恢复入口 */}
      {suspended && (
        <div className="resume-banner" role="alert">
          <span>音频被系统暂停了</span>
          <button
            className="resume-banner-btn"
            onClick={() => {
              symphonyEngine.unlock();
            }}
          >
            点按恢复
          </button>
        </div>
      )}

      {/* 屏幕阅读器公告（替代反馈通道） */}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="container mx-auto px-6">
        <header className="mb-10 animate-fade-in-up opacity-0">
          <span className="font-mono text-xs tracking-[0.3em] uppercase text-glow-primary block mb-3">
            Microbial Symphony
          </span>
          <h1 className="font-display text-5xl md:text-6xl font-bold text-text-light mb-4">
            微观交响厅
          </h1>
          <p className="font-mono text-sm text-text-muted max-w-2xl leading-relaxed">
            大小决定音高 · 适温决定音色亮度 · 代谢决定节奏疏密 · 致病性决定和声紧张度。
            参数全部由服务端统一推导，同一条标本在任何设备上听到的都是同一套数值。
          </p>
        </header>

        {/* ---------- 当前交响 ---------- */}
        <section className="glass-card p-6 sm:p-8 mb-12 animate-fade-in-up stagger-1 opacity-0" aria-label="当前交响">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <h2 className="font-display text-2xl font-semibold text-text-light flex items-center gap-3">
              <AudioLines className="w-5 h-5 text-glow-primary" aria-hidden="true" />
              当前交响
              <span className="font-mono text-xs text-text-muted">
                {composition.length} / {MAX_LAYERS}
              </span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn-primary px-5 py-2 text-sm"
                onClick={handlePlay}
                disabled={empty || playing}
              >
                <Play className="w-4 h-4" aria-hidden="true" />
                播放
              </button>
              <button
                className="btn-primary-ghost px-4 py-2 text-sm"
                onClick={() => symphonyEngine.stop()}
                disabled={!playing}
              >
                <Square className="w-4 h-4" aria-hidden="true" />
                停止
              </button>
              <button
                className="btn-primary-ghost px-4 py-2 text-sm"
                onClick={handleMute}
                aria-pressed={muted}
                disabled={!unlocked}
              >
                {muted ? (
                  <VolumeX className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Volume2 className="w-4 h-4" aria-hidden="true" />
                )}
                {muted ? '取消静音' : '静音'}
              </button>
              <button
                className="btn-primary-ghost px-4 py-2 text-sm"
                onClick={handleShare}
                disabled={empty}
              >
                <Share2 className="w-4 h-4" aria-hidden="true" />
                分享
              </button>
              <button
                className="btn-primary-ghost px-4 py-2 text-sm"
                onClick={handleDownload}
                disabled={empty || downloadState !== 'idle'}
              >
                {downloadState === 'idle' ? (
                  <Download className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                )}
                {downloadState === 'queued' && `排队中（第 ${queuePos} 位）`}
                {downloadState === 'processing' && '服务端渲染中…'}
                {downloadState === 'idle' && '下载 WAV'}
              </button>
              <button
                className="btn-primary-ghost px-4 py-2 text-sm"
                onClick={clear}
                disabled={empty}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                清空
              </button>
            </div>
          </div>

          {empty ? (
            <p className="font-mono text-sm text-text-muted py-6 text-center">
              点下方任意标本卡片，把它加入交响（最多 {MAX_LAYERS} 条），加入时即可试听它的声音。
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-6">
                {compositionVoices.map((v, i) => (
                  <span
                    key={v.microbe.id}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-glow-primary/10 border border-glow-primary/30 font-mono text-xs text-text-light"
                  >
                    <span className="text-glow-primary">{i + 1}.</span>
                    {v.microbe.name}
                    <button
                      className="text-text-muted hover:text-glow-red transition-colors"
                      onClick={() => remove(v.microbe.id)}
                      aria-label={`移除${v.microbe.name}`}
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>

              <StepVisualizer voices={compositionVoices} currentStep={currentStep} />

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-5">
                <p className="font-mono text-xs text-text-muted" aria-hidden="true">
                  {playing
                    ? `${muted ? '🔇 已静音 · ' : ''}第 ${beat} 拍 · ${composition.length} 个声部`
                    : '待播放'}
                </p>
                {muted && (
                  <span className="symphony-chip">已静音 · 视觉反馈中</span>
                )}
                {reducedMotion && (
                  <span className="symphony-chip">已适配「减弱动态」· 静态高亮与文字反馈</span>
                )}
              </div>
            </>
          )}
        </section>

        {/* ---------- 馆藏点听 ---------- */}
        <section aria-label="馆藏标本">
          <div className="flex items-end justify-between mb-6">
            <h2 className="font-display text-3xl font-semibold text-text-light flex items-center gap-3">
              <Music className="w-6 h-6 text-glow-primary" aria-hidden="true" />
              馆藏点听
            </h2>
            <p className="font-mono text-xs text-text-muted hidden sm:block">
              点击卡片 = 加入交响并试听
            </p>
          </div>

          {loading && (
            <p className="font-mono text-sm text-text-muted py-12 text-center">
              正在向服务端取参数…
            </p>
          )}
          {error && (
            <p className="font-mono text-sm text-glow-red py-12 text-center">加载失败：{error}</p>
          )}

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {voices.map((v) => {
              const inComp = composition.includes(v.microbe.id);
              const order = composition.indexOf(v.microbe.id);
              return (
                <button
                  key={v.microbe.id}
                  className={`symphony-card ${inComp ? 'symphony-card-active' : ''}`}
                  onClick={() => handleToggle(v)}
                  aria-pressed={inComp}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="text-left">
                      <p className="font-display text-lg font-semibold text-text-light leading-tight">
                        {v.microbe.name}
                      </p>
                      <p className="font-mono text-[10px] text-text-muted italic">
                        {v.microbe.scientificName}
                      </p>
                    </div>
                    <span className={`category-badge category-badge-${v.microbe.category} text-[10px] px-2 py-0.5 shrink-0`}>
                      {CATEGORY_LABELS[v.microbe.category]}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-left font-mono text-[11px]">
                    <p className="text-text-muted">
                      音高 <span className="text-glow-primary">{noteName(v.audio.midi)}</span>
                    </p>
                    <p className="text-text-muted">
                      亮度{' '}
                      <span className="text-glow-primary">
                        {Math.round(v.audio.brightness * 100)}%
                      </span>
                    </p>
                    <p className="text-text-muted">
                      节奏{' '}
                      <span className="text-text-light">
                        {v.audio.rhythm.density}/16 · {METABOLISM_LABELS[v.bio.metabolism]}
                      </span>
                    </p>
                    <p className="text-text-muted">
                      和声 <span className="text-text-light">{v.audio.harmony.label}</span>
                    </p>
                    <p className="col-span-2 text-text-muted/70 text-[10px]">
                      {formatSize(v.bio.sizeUm)} · {v.bio.tempC}°C · {PATHOGENICITY_LABELS[v.bio.pathogenicity]}
                    </p>
                  </div>

                  {inComp && (
                    <span className="absolute top-3 right-3 flex items-center justify-center w-6 h-6 rounded-full bg-glow-primary text-background-deep font-mono text-xs font-bold">
                      {order + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
