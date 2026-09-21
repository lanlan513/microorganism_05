import { useMemo, useState } from 'react';
import { Plus, Check, Search, X } from 'lucide-react';
import type { Microbe, MicrobeCategory } from '../../../shared/types';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../../../shared/types';
import { MAX_VOICES } from '../../../shared/derive';
import type { VoiceMicrobeMeta } from '../../utils/api';

interface Props {
  microbes: Microbe[];
  selected: VoiceMicrobeMeta[];
  onToggle: (m: Microbe) => void;
  open: boolean;
  onClose: () => void;
}

/** 标本挑选抽屉：从馆藏中选最多 6 条叠进交响 */
export function MicrobePicker({ microbes, selected, onToggle, open, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<MicrobeCategory | 'all'>('all');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return microbes.filter((m) => {
      if (cat !== 'all' && m.category !== cat) return false;
      if (!q) return true;
      return m.name.toLowerCase().includes(q) || m.scientificName.toLowerCase().includes(q);
    });
  }, [microbes, query, cat]);

  const selectedIds = new Set(selected.map((m) => m.id));
  const full = selected.length >= MAX_VOICES;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-background-deep/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-2xl max-h-[80vh] m-0 sm:m-4 glass-card rounded-b-none sm:rounded-3xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h3 className="font-display text-xl text-text-light">
            挑选标本
            <span className="ml-2 font-mono text-xs text-text-muted">
              {selected.length}/{MAX_VOICES} 声部
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-text-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 border-b border-white/10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标本名 / 学名"
              className="w-full bg-white/5 border border-white/10 rounded-full pl-10 pr-4 py-2.5 text-sm text-text-light placeholder:text-text-muted/60 focus:outline-none focus:border-glow-primary/50"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {(['all', 'bacteria', 'fungi', 'virus', 'archaea'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className={`font-mono text-xs px-3 py-1 rounded-full border transition-colors ${
                  cat === c
                    ? 'border-glow-primary text-glow-primary bg-glow-primary/10'
                    : 'border-white/15 text-text-muted hover:text-text-light'
                }`}
              >
                {c === 'all' ? '全部' : CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto p-4 grid sm:grid-cols-2 gap-3">
          {list.map((m) => {
            const picked = selectedIds.has(m.id);
            const disabled = !picked && full;
            const color = CATEGORY_COLORS[m.category];
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => onToggle(m)}
                className={`flex items-center gap-3 p-2.5 rounded-2xl border text-left transition-all disabled:opacity-40 ${
                  picked
                    ? 'border-glow-primary/60 bg-glow-primary/10'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/30'
                }`}
              >
                <img src={m.imageUrl} alt="" loading="lazy" className="w-11 h-11 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-light truncate flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                    {m.name}
                  </div>
                  <div className="text-[10px] text-text-muted truncate">
                    {m.scientificName} · {m.size} · {m.tempC}°C
                  </div>
                </div>
                <span className="w-6 h-6 shrink-0 rounded-full flex items-center justify-center border">
                  {picked
                    ? <Check className="w-3.5 h-3.5 text-glow-primary" />
                    : <Plus className="w-3.5 h-3.5 text-text-muted" />}
                </span>
              </button>
            );
          })}
          {list.length === 0 && (
            <p className="col-span-2 text-center font-mono text-sm text-text-muted py-10">
              没有匹配的标本
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
