import { create } from 'zustand';
import type { SymphonyParams, SymphonyVoice } from '../../shared/types';
import { api } from '../utils/api';

export const MAX_LAYERS = 6;

interface SymphonyState {
  /** 全馆声部（参数全部由服务端推导） */
  voices: SymphonyVoice[];
  transport: SymphonyParams['transport'] | null;
  /** 当前交响：已选标本 id（按加入顺序） */
  composition: number[];
  loading: boolean;
  error: string | null;
  fetchParams: () => Promise<void>;
  toggle: (id: number) => boolean;
  remove: (id: number) => void;
  setComposition: (ids: number[]) => void;
  clear: () => void;
}

export const useSymphonyStore = create<SymphonyState>((set, get) => ({
  voices: [],
  transport: null,
  composition: [],
  loading: false,
  error: null,

  fetchParams: async () => {
    if (get().voices.length > 0 || get().loading) return;
    set({ loading: true, error: null });
    try {
      const data = await api.getSymphonyParams();
      set({ voices: data.voices, transport: data.transport, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  /** 返回 false 表示已达层数上限，未加入 */
  toggle: (id) => {
    const { composition } = get();
    if (composition.includes(id)) {
      set({ composition: composition.filter((c) => c !== id) });
      return true;
    }
    if (composition.length >= MAX_LAYERS) return false;
    set({ composition: [...composition, id] });
    return true;
  },

  remove: (id) => set({ composition: get().composition.filter((c) => c !== id) }),

  setComposition: (ids) => {
    const { voices } = get();
    const valid = ids.filter((id) => voices.some((v) => v.microbe.id === id));
    set({ composition: [...new Set(valid)].slice(0, MAX_LAYERS) });
  },

  clear: () => set({ composition: [] }),
}));
