import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Music4, Plus, RotateCcw } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useSymphony } from '../hooks/useSymphony';
import { SymphonyVisualizer } from '../components/symphony/SymphonyVisualizer';
import { PlayerControls } from '../components/symphony/PlayerControls';
import { VoiceCard } from '../components/symphony/VoiceCard';
import { ShareDownloadBar } from '../components/symphony/ShareDownloadBar';
import { MicrobePicker } from '../components/symphony/MicrobePicker';
import { MAX_VOICES } from '../../shared/derive';

export function SymphonyPage() {
  const { token } = useParams<{ token?: string }>();
  const { microbes, fetchMicrobes } = useAppStore();
  const sym = useSymphony();
  const [pickerOpen, setPickerOpen] = useState(false);

  // 全量馆藏供挑选（接口本身支持无分页拉取）
  useEffect(() => {
    fetchMicrobes();
  }, [fetchMicrobes]);

  // 分享链接：由服务端按 token 重新推导同一份总谱；
  // 或来自详情页的 ?ids=1,2（先经服务端推导，再把 token 写进地址栏）
  useEffect(() => {
    if (token) {
      void sym.loadToken(token);
      return;
    }
    const idsParam = new URLSearchParams(window.location.search).get('ids');
    if (idsParam) {
      const ids = idsParam.split(',').map((s) => Number(s.trim())).filter(Number.isInteger);
      if (ids.length > 0) void sym.loadByIds(ids);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const voiceById = useMemo(() => {
    const map = new Map(sym.bundle?.plan.voices.map((v) => [v.microbeId, v]) ?? []);
    return map;
  }, [sym.bundle]);

  return (
    <div className="relative min-h-screen pt-28 pb-20">
      <div className="container mx-auto px-6 max-w-6xl">
        <header className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-glow-primary/30 bg-glow-primary/5 mb-5">
            <Music4 className="w-3.5 h-3.5 text-glow-primary" />
            <span className="font-mono text-[11px] text-glow-primary tracking-[0.25em] uppercase">
              Microbial Symphony
            </span>
          </div>
          <h1 className="font-display text-4xl md:text-6xl font-bold text-text-light mb-4">
            微观<span className="text-gradient-primary text-shadow-glow">交响</span>
          </h1>
          <p className="font-mono text-sm text-text-muted/80 max-w-2xl mx-auto leading-relaxed">
            大小决定音高，喜温决定音色，需氧厌氧决定呼吸疏密，致病性决定和声紧张。
            选几条标本叠在一起听 —— 所有声音参数由服务端推导，任何设备、任何分享对象听到的都是同一套数值。
          </p>
        </header>

        {sym.error && (
          <div className="max-w-md mx-auto mb-8 text-center p-4 rounded-2xl border border-red-400/30 bg-red-400/10 font-mono text-sm text-red-300">
            {sym.error}
          </div>
        )}

        {!sym.bundle ? (
          <EmptyState onPick={() => setPickerOpen(true)} loading={sym.loading} />
        ) : (
          <div className="grid lg:grid-cols-2 gap-10 items-start">
            {/* 左：舞台 */}
            <div className="glass-card p-6 md:p-8 flex flex-col items-center sticky top-24">
              <SymphonyVisualizer
                voices={sym.bundle.plan.voices}
                step={sym.step}
                pulseTick={sym.pulseTick}
                lastNote={sym.lastNoteRef.current}
                reducedMotion={sym.capabilities.prefersReducedMotion}
                muted={sym.muted}
              />
              <PlayerControls
                status={sym.status}
                blocked={sym.blocked}
                everPlayed={sym.everPlayed}
                muted={sym.muted}
                loading={sym.loading}
                disabled={!sym.bundle}
                onTogglePlay={sym.togglePlay}
                onToggleMute={sym.toggleMute}
              />
              <div className="w-full mt-4 pt-5 border-t border-white/10">
                <ShareDownloadBar
                  disabled={!sym.bundle}
                  download={sym.download}
                  onShare={sym.share}
                  onRequestDownload={sym.requestDownload}
                />
              </div>
            </div>

            {/* 右：声部 */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-xl text-text-light">
                  声部（{sym.selected.length}）
                </h2>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    disabled={sym.selected.length >= MAX_VOICES}
                    className="btn-primary-ghost !px-4 !py-2 text-xs disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    添加标本
                  </button>
                  <button
                    type="button"
                    onClick={sym.clear}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/15 text-text-muted hover:text-text-light text-xs transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    重置
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {sym.selected.map((m) => (
                  <VoiceCard
                    key={m.id}
                    microbe={m}
                    voice={voiceById.get(m.id)}
                    onRemove={sym.removeMicrobe}
                  />
                ))}
              </div>

              <div className="mt-6 p-4 rounded-2xl bg-white/[0.03] border border-white/10 font-mono text-[11px] text-text-muted/80 leading-relaxed">
                <p>· 参数版本 schema v{sym.bundle.plan.schemaVersion} · {sym.bundle.plan.bpm} BPM ·
                  循环 {sym.bundle.plan.loopDuration.toFixed(1)}s × {sym.bundle.plan.loops} 遍（下载版）</p>
                <p className="mt-1">· 在线试听为无限循环实时合成，下载为服务端排队生成的 WAV，二者共用同一套总谱。</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <MicrobePicker
        microbes={microbes}
        selected={sym.selected}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onToggle={(m) => {
          if (sym.selected.some((s) => s.id === m.id)) {
            sym.removeMicrobe(m.id);
          } else {
            void sym.addMicrobe(m);
            if (sym.selected.length + 1 >= MAX_VOICES) setPickerOpen(false);
          }
        }}
      />
    </div>
  );
}

function EmptyState({ onPick, loading }: { onPick: () => void; loading: boolean }) {
  return (
    <div className="max-w-xl mx-auto glass-card p-12 text-center">
      <div className="w-20 h-20 mx-auto rounded-full bg-glow-primary/10 border border-glow-primary/30 flex items-center justify-center mb-6">
        <Music4 className="w-9 h-9 text-glow-primary" />
      </div>
      <h2 className="font-display text-2xl text-text-light mb-3">从馆藏选一条标本开始</h2>
      <p className="font-mono text-sm text-text-muted/80 mb-8 leading-relaxed">
        也可以多选几条叠成合奏。手机上首次播放需要你亲手点一下播放键 ——
        这是浏览器的自动播放策略，任何网页都无法绕过。
      </p>
      <button type="button" onClick={onPick} disabled={loading} className="btn-primary">
        <Plus className="w-4 h-4" />
        {loading ? '正在生成总谱…' : '挑选标本'}
      </button>
    </div>
  );
}
