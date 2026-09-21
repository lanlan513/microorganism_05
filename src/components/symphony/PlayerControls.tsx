import { Pause, Play, Volume2, VolumeX, Loader2, Lock } from 'lucide-react';
import type { EngineStatus } from '../../audio/SymphonyEngine';

interface Props {
  status: EngineStatus;
  blocked: boolean; // 自动播放策略拦截
  everPlayed: boolean; // 本次会话是否成功出过声
  muted: boolean;
  loading: boolean;
  disabled: boolean;
  onTogglePlay: () => void;
  onToggleMute: () => void;
}

/**
 * 播放控制。
 * 自动播放策略：移动端首次点击若 context 仍 suspended，按钮区域出现
 * "再点一次"引导，下一次真实手势继续解锁 —— 不做任何绕过。
 */
export function PlayerControls({
  status, blocked, everPlayed, muted, loading, disabled, onTogglePlay, onToggleMute,
}: Props) {
  const isPlaying = status === 'running' || status === 'muted';
  const suspended = status === 'suspended';

  return (
    <div className="relative">
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={disabled || loading}
          aria-label={isPlaying ? '暂停' : '播放'}
          className="relative w-16 h-16 rounded-full bg-gradient-to-br from-glow-primary/30 to-glow-purple/30 border border-glow-primary/50 flex items-center justify-center text-text-light hover:shadow-glow transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
        >
          {loading ? (
            <Loader2 className="w-7 h-7 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-7 h-7" fill="currentColor" />
          ) : (
            <Play className="w-7 h-7 ml-1" fill="currentColor" />
          )}
          {(isPlaying || suspended) && (
            <span
              className={`absolute inset-0 rounded-full border ${
                isPlaying ? 'border-glow-primary/60 animate-ping-slow' : 'border-amber-400/50'
              } pointer-events-none`}
            />
          )}
        </button>

        <button
          type="button"
          onClick={onToggleMute}
          disabled={disabled}
          aria-label={muted ? '取消静音' : '静音'}
          className="w-11 h-11 rounded-full border border-white/15 bg-white/5 flex items-center justify-center text-text-muted hover:text-text-light transition-colors disabled:opacity-40"
        >
          {muted ? <VolumeX className="w-5 h-5 text-amber-300" /> : <Volume2 className="w-5 h-5" />}
        </button>
      </div>

      {/* 状态提示 */}
      <div className="h-6 mt-3 text-center font-mono text-xs tracking-wider">
        {blocked && (
          <span className="inline-flex items-center gap-1.5 text-amber-300">
            <Lock className="w-3.5 h-3.5" />
            浏览器自动播放策略：请再点一次播放键开启声音
          </span>
        )}
        {!blocked && suspended && everPlayed && (
          <span className="text-amber-300/90">音频已被系统挂起（锁屏/切后台），点播放恢复</span>
        )}
        {!blocked && suspended && !everPlayed && (
          <span className="text-text-muted">点播放键开始（移动端需你亲手点，无法自动出声）</span>
        )}
        {!blocked && !suspended && isPlaying && muted && (
          <span className="text-text-muted">已静音：正在用涟漪与震动替代发声</span>
        )}
        {!blocked && !suspended && isPlaying && !muted && (
          <span className="text-glow-primary/80">演奏中 · Web Audio 实时合成</span>
        )}
        {!blocked && !suspended && !isPlaying && status === 'paused' && (
          <span className="text-text-muted">已暂停，点播放继续</span>
        )}
        {!blocked && !suspended && !isPlaying && status === 'unsupported' && (
          <span className="text-text-muted">当前浏览器不支持 Web Audio，以视觉/触觉方式呈现</span>
        )}
      </div>
    </div>
  );
}
