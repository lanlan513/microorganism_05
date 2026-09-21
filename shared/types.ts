export type MicrobeCategory = 'bacteria' | 'fungi' | 'virus' | 'archaea';

export const CATEGORY_LABELS: Record<MicrobeCategory, string> = {
  bacteria: '细菌',
  fungi: '真菌',
  virus: '病毒',
  archaea: '古菌',
};

export const CATEGORY_COLORS: Record<MicrobeCategory, string> = {
  bacteria: '#00ffc8',
  fungi: '#9b59b6',
  virus: '#e74c3c',
  archaea: '#f1c40f',
};

export interface Microbe {
  id: number;
  name: string;
  scientificName: string;
  category: MicrobeCategory;
  habitat: string;
  description: string;
  imageUrl: string;
  discoveredYear: number;
  size: string;
  characteristics: string[];
  /** 声音映射原始字段：典型体长 μm */
  sizeUm: number;
  /** 最适生长温度 °C */
  tempC: number;
  /** 代谢类型：需氧 / 厌氧 / 兼性 */
  metabolism: 'aerobic' | 'anaerobic' | 'facultative';
  /** 致病性等级 0-3 */
  pathogenicity: 0 | 1 | 2 | 3;
  pathogenicityNote?: string;
}

export interface Stats {
  total: number;
  bacteria: number;
  fungi: number;
  virus: number;
  archaea: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
