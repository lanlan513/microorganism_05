import type { Microbe, MicrobeCategory, Stats, ApiResponse } from '../../shared/types';
import type { RenderJob, SymphonyPlan } from '../../shared/symphony';

const API_BASE = '/api';

async function request<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data: ApiResponse<T> = await res.json();
  if (!data.success || !data.data) {
    throw new Error(data.error || '请求失败');
  }
  return data.data;
}

export const api = {
  getMicrobes: (params?: { category?: MicrobeCategory; search?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.search) query.set('search', params.search);
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    if (params?.offset !== undefined) query.set('offset', String(params.offset));
    const queryStr = query.toString();
    return request<Microbe[]>(`/microbes${queryStr ? `?${queryStr}` : ''}`);
  },

  getMicrobeById: (id: number) => request<Microbe>(`/microbes/${id}`),

  getMicrobesByCategory: (category: MicrobeCategory) => request<Microbe[]>(`/microbes/category/${category}`),

  getRelated: (id: number, limit: number = 4) => request<Microbe[]>(`/microbes/${id}/related?limit=${limit}`),

  getStats: () => request<Stats>('/stats'),
};

/** 交响页展示用的标本摘要（由服务端返回） */
export interface VoiceMicrobeMeta {
  id: number;
  name: string;
  scientificName: string;
  category: Microbe['category'];
  imageUrl: string;
  size: string;
  sizeUm: number;
  tempC: number;
  metabolism: Microbe['metabolism'];
  pathogenicity: Microbe['pathogenicity'];
  pathogenicityNote?: string;
}

export interface SymphonyBundle {
  token: string;
  shareUrl: string;
  plan: SymphonyPlan;
  microbes: VoiceMicrobeMeta[];
}

export const symphonyApi = {
  createPlan: (ids: number[]) =>
    request<SymphonyBundle>('/symphony/plan', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  getPlanByToken: (token: string) => request<SymphonyBundle>(`/symphony/plan/${token}`),

  enqueueRender: (token: string) =>
    request<RenderJob>('/symphony/render', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  getRender: (id: string, token: string) =>
    request<RenderJob>(`/symphony/render/${id}?token=${encodeURIComponent(token)}`),

  downloadUrl: (id: string, token: string) =>
    `${API_BASE}/symphony/render/${id}/download?token=${encodeURIComponent(token)}`,
};
