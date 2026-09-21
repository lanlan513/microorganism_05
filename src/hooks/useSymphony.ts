import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SymphonyEngine, type EngineStatus, type NoteCallbackInfo } from '../audio/SymphonyEngine';
import { detectCapabilities } from '../audio/capabilities';
import { symphonyApi, type SymphonyBundle, type VoiceMicrobeMeta } from '../utils/api';
import type { RenderJob } from '../../shared/symphony';
import { MAX_VOICES } from '../../shared/derive';

export interface DownloadState {
  job?: RenderJob;
  url?: string; // 完成后的下载地址
  error?: string;
}

const capabilities = detectCapabilities();

export function useSymphony() {
  const engineRef = useRef<SymphonyEngine | null>(null);
  const [bundle, setBundle] = useState<SymphonyBundle | null>(null);
  const [selected, setSelected] = useState<VoiceMicrobeMeta[]>([]);
  const [status, setStatus] = useState<EngineStatus>('idle');
  const [step, setStep] = useState(0);
  const [pulseTick, setPulseTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [blocked, setBlocked] = useState(false); // 自动播放策略拦截，等首次手势
  const [everPlayed, setEverPlayed] = useState(false); // 本次会话是否成功出过声
  const [download, setDownload] = useState<DownloadState>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastNoteRef = useRef<NoteCallbackInfo | null>(null);
  const wasPlayingRef = useRef(false);

  // 引擎单例
  if (!engineRef.current) {
    engineRef.current = new SymphonyEngine({
      onStatus: (s) => {
        setStatus(s);
        if (s === 'running' || s === 'muted') {
          wasPlayingRef.current = true;
          setEverPlayed(true);
          setBlocked(false);
        }
      },
      onStep: setStep,
      onNote: (info) => {
        // 供可视化读取（ref 不引起渲染）；pulseTick 统一驱动画面刷新
        lastNoteRef.current = info;
        setPulseTick((t) => t + 1);
      },
    });
  }

  useEffect(() => () => {
    engineRef.current?.destroy();
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  // 总谱变化即装载；若此前已在播放（ctx 已被用户手势解锁），换谱自动续播
  useEffect(() => {
    if (bundle) {
      engineRef.current?.load(bundle.plan, wasPlayingRef.current);
      setStep(0);
      setBlocked(false);
    }
  }, [bundle]);

  const toggleByIds = useCallback(async (microbes: VoiceMicrobeMeta[]) => {
    const ids = microbes.map((m) => m.id);
    setLoading(true);
    setError(null);
    try {
      const next = await symphonyApi.createPlan(ids);
      setBundle(next);
      setSelected(next.microbes);
      setDownload({});
      // URL 同步但不刷新页面，保证刷新/转发后由服务端重新推导同一套参数
      window.history.replaceState(null, '', next.shareUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成总谱失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadToken = useCallback(async (token: string) => {
    setLoading(true);
    setError(null);
    try {
      const next = await symphonyApi.getPlanByToken(token);
      setBundle(next);
      setSelected(next.microbes);
    } catch (err) {
      setError(err instanceof Error ? err.message : '分享链接无效');
      setBundle(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 直接按 id 列表推导（来源：详情页 ?ids= 等快捷入口），推导后回写 token 地址 */
  const loadByIds = useCallback(async (ids: number[]) => {
    setLoading(true);
    setError(null);
    try {
      const next = await symphonyApi.createPlan(ids);
      setBundle(next);
      setSelected(next.microbes);
      setDownload({});
      window.history.replaceState(null, '', next.shareUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成总谱失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const addMicrobe = useCallback((m: VoiceMicrobeMeta) => {
    if (selected.some((s) => s.id === m.id)) return;
    if (selected.length >= MAX_VOICES) return;
    void toggleByIds([...selected, m]);
  }, [selected, toggleByIds]);

  const removeMicrobe = useCallback((id: number) => {
    const next = selected.filter((m) => m.id !== id);
    if (next.length === 0) {
      engineRef.current?.stop();
      setBundle(null);
      setSelected([]);
      window.history.replaceState(null, '', '/symphony');
      return;
    }
    void toggleByIds(next);
  }, [selected, toggleByIds]);

  /** 播放/暂停：必须在 onClick 调用栈里直接 await，移动端才能解锁自动播放 */
  const togglePlay = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !bundle) return;
    const s = engine.getStatus();
    if (s === 'running' || s === 'muted') {
      engine.pause();
      return;
    }
    const ok = await engine.play();
    if (!ok) {
      // 被自动播放策略拦截：显示"点按出声"引导，下一次点击继续尝试
      setBlocked(true);
    }
  }, [bundle]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMutedState(next);
    engineRef.current?.setMuted(next);
  }, [muted]);

  const share = useCallback(async () => {
    if (!bundle) return { ok: false as const };
    const url = `${window.location.origin}${bundle.shareUrl}`;
    // 优先 Web Share（移动端系统分享面板）；不可用时复制链接
    if (navigator.share) {
      try {
        await navigator.share({
          title: '微观交响 · 微生物文明馆',
          text: `${selected.map((m) => m.name).join('、')} 正在合奏，来听听标本的声音`,
          url,
        });
        return { ok: true as const };
      } catch (err) {
        if ((err as Error).name === 'AbortError') return { ok: true as const };
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      return { ok: true as const, copied: true };
    } catch {
      return { ok: false as const, url };
    }
  }, [bundle, selected]);

  const requestDownload = useCallback(async () => {
    if (!bundle || pollRef.current) return;
    setDownload({});
    try {
      const job = await symphonyApi.enqueueRender(bundle.token);
      setDownload({ job });

      pollRef.current = setInterval(async () => {
        try {
          const latest = await symphonyApi.getRender(job.id, bundle.token);
          setDownload({ job: latest, url: latest.status === 'done'
            ? symphonyApi.downloadUrl(latest.id, bundle.token)
            : undefined });
          if (latest.status === 'done' || latest.status === 'error') {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } catch (err) {
          setDownload({ job, error: err instanceof Error ? err.message : '任务查询失败' });
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 1000);
    } catch (err) {
      setDownload({ error: err instanceof Error ? err.message : '排队失败' });
    }
  }, [bundle]);

  const isPlaying = status === 'running' || status === 'muted';

  return useMemo(() => ({
    bundle,
    selected,
    status,
    isPlaying,
    step,
    pulseTick,
    loading,
    error,
    muted,
    blocked,
    everPlayed,
    download,
    capabilities,
    lastNoteRef,
    toggleByIds,
    loadToken,
    loadByIds,
    addMicrobe,
    removeMicrobe,
    togglePlay,
    toggleMute,
    share,
    requestDownload,
    clear: () => {
      engineRef.current?.stop();
      setBundle(null);
      setSelected([]);
      window.history.replaceState(null, '', '/symphony');
    },
  }), [
    bundle, selected, status, isPlaying, step, pulseTick, loading, error, muted, blocked,
    everPlayed, download, toggleByIds, loadToken, loadByIds, addMicrobe, removeMicrobe, togglePlay,
    toggleMute, share, requestDownload,
  ]);
}
