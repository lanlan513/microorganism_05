import type { SymphonyVoice } from '../../../shared/types';

interface StepVisualizerProps {
  voices: SymphonyVoice[];
  /** 当前步进（0~15），-1 表示未播放 */
  currentStep: number;
}

/**
 * 每条声部一行 16 步：实心点是该标本的节奏型，亮柱是当前播放位置。
 * 静音或系统开启「减弱动态」时，播放反馈主要靠它呈现（离散高亮，无动画）。
 */
export function StepVisualizer({ voices, currentStep }: StepVisualizerProps) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {voices.map((v) => (
        <div key={v.microbe.id} className="flex items-center gap-2 sm:gap-3">
          <span className="w-16 sm:w-24 shrink-0 truncate text-right font-mono text-[10px] text-text-muted">
            {v.microbe.name}
          </span>
          <div className="step-grid flex-1">
            {v.audio.rhythm.steps.map((on, i) => (
              <span
                key={i}
                className={`step-cell ${on ? 'step-on' : ''} ${i === currentStep ? 'step-now' : ''}`}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
