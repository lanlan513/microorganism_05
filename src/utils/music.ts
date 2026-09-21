const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI 音符号 → 音名（69 → A4） */
export function noteName(midi: number): string {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

/** µm 数值 → 人类可读的尺寸 */
export function formatSize(um: number): string {
  if (um < 1) return `${Math.round(um * 1000)}nm`;
  if (um < 1000) return `${um}µm`;
  if (um < 10000) return `${um / 1000}mm`;
  return `${um / 10000}cm`;
}
