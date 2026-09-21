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

/* ================= 微观交响 =================
 * 参数推导只在服务端进行：同一标本在任何设备上得到同一套数值，
 * 分享链接里只带标本 id，接收方重新向服务端取参数，听到的必是同一段。
 */

export type Metabolism = 'aerobic' | 'anaerobic' | 'facultative' | 'parasitic';

export const METABOLISM_LABELS: Record<Metabolism, string> = {
  aerobic: '需氧',
  anaerobic: '厌氧',
  facultative: '兼性厌氧',
  parasitic: '专性寄生',
};

export const PATHOGENICITY_LABELS = ['无害', '条件致病', '致病', '强致病'] as const;

/** 标本的声学相关生物学属性（服务端策展数据，推导的唯一输入） */
export interface MicrobeBio {
  id: number;
  /** 代表尺寸（µm）——对数映射音高：越大越低沉 */
  sizeUm: number;
  /** 最适温度（°C）——映射音色亮度：越嗜热越明亮 */
  tempC: number;
  /** 代谢方式——映射节奏疏密（寄生者反拍切分） */
  metabolism: Metabolism;
  /** 致病性 0~3——映射和声紧张度 */
  pathogenicity: number;
}

/** 服务端推导出的可听化参数（客户端只消费，不推导） */
export interface AudioParams {
  /** 音高（MIDI 音符号） */
  midi: number;
  /** 音色亮度 0~1 */
  brightness: number;
  /** 低通截止频率 Hz */
  cutoffHz: number;
  /** 节奏型：一小节 16 步 */
  rhythm: { steps: boolean[]; density: number };
  /** 和声：叠加的音程（半音）与失谐 */
  harmony: { intervals: number[]; detuneCents: number; label: string };
  /** 余音衰减时长（秒） */
  decaySeconds: number;
}

/** 一条标本及其声部参数 */
export interface SymphonyVoice {
  microbe: Microbe;
  bio: MicrobeBio;
  audio: AudioParams;
}

export interface SymphonyTransport {
  bpm: number;
  stepsPerBar: number;
  /** 服务端渲染下载文件时的小节数（浏览器端循环单小节） */
  bars: number;
}

export interface SymphonyParams {
  transport: SymphonyTransport;
  voices: SymphonyVoice[];
}

export type RenderJobStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface RenderJobView {
  id: string;
  status: RenderJobStatus;
  /** 排队位置（0 = 不在队列中） */
  position: number;
  fileUrl?: string;
  error?: string;
}
