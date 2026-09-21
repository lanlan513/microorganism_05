import { X, Ruler, Thermometer, Wind, AlertTriangle } from 'lucide-react';
import type { VoiceMicrobeMeta } from '../../utils/api';
import type { VoicePlan } from '../../../shared/symphony';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../../../shared/types';

const METABOLISM_LABEL: Record<VoiceMicrobeMeta['metabolism'], string> = {
  aerobic: '需氧 · 节奏绵密',
  anaerobic: '厌氧 · 呼吸稀疏',
  facultative: '兼性 · 疏密居中',
};

const TEMP_LABEL: Record<VoicePlan['tempPreference'], string> = {
  psychrophile: '嗜冷 · 圆润',
  mesophile: '常温 · 温润',
  thermophile: '嗜热 · 明亮',
};

const PATHOGEN_LABEL = ['无害', '机会/低危', '条件致病', '烈性致病'];

interface Props {
  microbe: VoiceMicrobeMeta;
  voice?: VoicePlan;
  onRemove?: (id: number) => void;
  compact?: boolean;
}

/** 一条标本的"声音身份卡"：把四条映射规则可视化出来，数值全部来自服务端 */
export function VoiceCard({ microbe, voice, onRemove, compact }: Props) {
  const color = CATEGORY_COLORS[microbe.category];
  return (
    <div
      className="relative glass-card p-4 overflow-hidden"
      style={{ borderColor: `${color}44` }}
    >
      <div
        className="absolute -top-10 -right-10 w-24 h-24 rounded-full blur-2xl opacity-30"
        style={{ background: color }}
      />
      <div className="relative flex items-start gap-3">
        <img
          src={microbe.imageUrl}
          alt={microbe.name}
          loading="lazy"
          className="w-14 h-14 rounded-xl object-cover border border-white/10 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-display text-base text-text-light truncate">{microbe.name}</h4>
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded-full shrink-0"
              style={{ color, background: `${color}18`, border: `1px solid ${color}33` }}
            >
              {CATEGORY_LABELS[microbe.category]}
            </span>
          </div>
          <p className="text-[11px] italic text-text-muted truncate">{microbe.scientificName}</p>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(microbe.id)}
            aria-label={`移除 ${microbe.name}`}
            className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center text-text-muted hover:text-text-light shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {voice && !compact && (
        <div className="relative mt-3 grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[11px]">
          <MappingRow
            icon={<Ruler className="w-3.5 h-3.5" />}
            label="大小→音高"
            value={`${voice.noteName} · ${voice.baseFreq}Hz`}
          />
          <MappingRow
            icon={<Thermometer className="w-3.5 h-3.5" />}
            label="喜温→音色"
            value={`${microbe.tempC}°C · ${voice.waveform}`}
            hint={TEMP_LABEL[voice.tempPreference]}
          />
          <MappingRow
            icon={<Wind className="w-3.5 h-3.5" />}
            label="代谢→节奏"
            value={METABOLISM_LABEL[microbe.metabolism]}
          />
          <MappingRow
            icon={<AlertTriangle className="w-3.5 h-3.5" />}
            label="致病→和声"
            value={PATHOGEN_LABEL[microbe.pathogenicity]}
            hint={voice.scaleMode}
            tone={microbe.pathogenicity >= 2 ? 'warn' : undefined}
          />
          <div className="col-span-2 pt-1">
            <div className="flex items-center justify-between text-text-muted mb-1">
              <span>和声紧张度</span>
              <span className="text-text-light">{Math.round(voice.tension * 100)}%</span>
            </div>
            <div className="h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${voice.tension * 100}%`,
                  background: microbe.pathogenicity >= 3
                    ? 'linear-gradient(90deg,#f1c40f,#e74c3c)'
                    : color,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MappingRow({
  icon, label, value, hint, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'warn';
}) {
  return (
    <div>
      <div className={`flex items-center gap-1.5 ${tone === 'warn' ? 'text-amber-300/90' : 'text-text-muted'}`}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-text-light mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-text-muted/70 leading-tight mt-0.5">{hint}</div>}
    </div>
  );
}
