// 微观交响：服务端推导、浏览器与离线渲染共用的类型契约
// 注意：此文件不依赖任何 Node / DOM API，可同时被 api/ 与 src/ 引用。

export type Metabolism = 'aerobic' | 'anaerobic' | 'facultative';

/** 致病性等级 0-3：0 无害 / 1 机会或低危 / 2 条件致病 / 3 烈性致病 */
export type Pathogenicity = 0 | 1 | 2 | 3;

/** 温度偏好：决定音色亮度与波形 */
export type TempPreference = 'mesophile' | 'psychrophile' | 'thermophile';

export interface SonificationTraits {
  /** 典型体长，单位 μm（病毒为粒径） */
  sizeUm: number;
  /** 最适生长温度，°C */
  tempC: number;
  /** 代谢类型：需氧 / 厌氧 / 兼性 */
  metabolism: Metabolism;
  /** 致病性等级 0-3 */
  pathogenicity: Pathogenicity;
  pathogenicityNote?: string;
}

/** 服务端为一条标本推导的完整声部参数 —— 同一条标本在任何设备上完全一致 */
export interface VoicePlan {
  /** 对应标本 id */
  microbeId: number;
  /** 标本分类（供客户端可视化取色，不参与声音推导） */
  category: string;
  /** 确定性种子（仅服务端可复现，客户端不重算） */
  seed: number;

  /** —— 大小 → 音高 —— */
  baseMidi: number;
  noteName: string;
  baseFreq: number;
  /** 和声走向（音级 1-7），由致病性决定调式，由种子决定走向 */
  degrees: number[];

  /** —— 喜温 → 音色亮度 —— */
  brightness: number; // 0-1
  tempPreference: TempPreference;
  waveform: 'sine' | 'triangle' | 'sawtooth' | 'square';
  cutoffHz: number;

  /** —— 代谢 → 节奏疏密 —— */
  density: number; // 每个十六分步发声音概率 0-1
  stepBreath: number; // 休止留白概率 0-1
  metabolism: Metabolism;
  noteBeats: number; // 单音持续的拍数

  /** —— 致病性 → 和声紧张度 —— */
  pathogenicity: Pathogenicity;
  tension: number; // 0-1
  chordIntervals: number[]; // 根音之外叠加的半音程
  scaleMode: string; // 调式说明（仅展示）

  /** 声像 0-1（0.5 居中），种子决定 */
  pan: number;
  /** 声部增益 0-1 */
  level: number;
}

export interface SymphonyNoteEvent {
  /** 相对循环起点的时间（秒） */
  time: number;
  /** 发声时长（秒） */
  duration: number;
  /** MIDI 音高（可含和弦多个音高） */
  midi: number[];
  /** 力度 0-1 */
  velocity: number;
  /** 是否为重拍和声（致病性驱动） */
  downbeat: boolean;
}

export interface SymphonyPlan {
  schemaVersion: number;
  bpm: number;
  steps: number;
  /** 单个循环时长（秒），播放端无限循环、下载端按 loops 渲染 */
  loopDuration: number;
  loops: number;
  voices: VoicePlan[];
  /** 每个声部在一个循环内的确定性音符序列 */
  events: Record<number, SymphonyNoteEvent[]>;
  /** 声部顺序（标本 id） */
  order: number[];
}

export interface RenderJob {
  id: string;
  token: string;
  status: 'queued' | 'rendering' | 'done' | 'error';
  progress: number; // 0-1
  createdAt: number;
  error?: string;
  file?: string; // 下载文件名
  size?: number; // 字节
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
