import { useState } from 'react';
import { Share2, Copy, Download, Loader2, Check, FileAudio } from 'lucide-react';
import type { DownloadState } from '../../hooks/useSymphony';

interface Props {
  disabled: boolean;
  download: DownloadState;
  onShare: () => Promise<{ ok: boolean; copied?: boolean; url?: string }>;
  onRequestDownload: () => void;
}

/** 分享与下载：下载是服务端排队任务，这里驱动轮询结果并给出最终下载链接 */
export function ShareDownloadBar({ disabled, download, onShare, onRequestDownload }: Props) {
  const [shareHint, setShareHint] = useState<string | null>(null);

  const handleShare = async () => {
    const r = await onShare();
    if (r.copied) {
      setShareHint('链接已复制，任何人打开都听到同一段');
    } else if (!r.ok && r.url) {
      setShareHint(r.url);
    } else if (r.ok) {
      setShareHint(null);
    }
    window.setTimeout(() => setShareHint(null), 4000);
  };

  const job = download.job;
  const isQueued = job?.status === 'queued' || job?.status === 'rendering';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={handleShare}
          disabled={disabled}
          className="btn-primary-quest"
        >
          <Share2 className="w-4 h-4" />
          分享这段交响
        </button>

        {download.url ? (
          <a href={download.url} className="btn-primary" download>
            <FileAudio className="w-4 h-4" />
            下载 WAV{(job?.size ? `（${(job.size / 1024 / 1024).toFixed(1)}MB）` : '')}
          </a>
        ) : (
          <button
            type="button"
            onClick={onRequestDownload}
            disabled={disabled || isQueued}
            className="btn-primary"
          >
            {isQueued ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {job?.status === 'queued' ? '排队中…' : `渲染中 ${Math.round((job?.progress ?? 0) * 100)}%`}
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                生成并下载 WAV
              </>
            )}
          </button>
        )}
      </div>

      {/* 任务进度条 */}
      {isQueued && (
        <div className="max-w-xs mx-auto">
          <div className="h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-glow-primary transition-all duration-500"
              style={{ width: `${(job?.status === 'queued' ? 0.08 : job?.progress ?? 0) * 100}%` }}
            />
          </div>
          <p className="text-center font-mono text-[10px] text-text-muted mt-1.5">
            服务端离线渲染中，可离开本页，完成后按钮会变成下载链接
          </p>
        </div>
      )}

      {download.error && (
        <p className="text-center font-mono text-xs text-red-400">{download.error}</p>
      )}
      {job?.status === 'error' && (
        <p className="text-center font-mono text-xs text-red-400">{job.error ?? '渲染失败'}</p>
      )}
      {download.url && (
        <p className="text-center font-mono text-[11px] text-glow-primary/80 inline-flex items-center gap-1 w-full justify-center">
          <Check className="w-3.5 h-3.5" />
          渲染完成，文件内容与这里实时听到的完全一致（同一套服务端参数）
        </p>
      )}

      {shareHint && (
        <p className="text-center font-mono text-[11px] text-text-muted inline-flex items-center gap-1 w-full justify-center">
          <Copy className="w-3.5 h-3.5" />
          {shareHint}
        </p>
      )}
    </div>
  );
}
