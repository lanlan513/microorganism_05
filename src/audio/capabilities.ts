// 设备能力探测：自动播放策略 / 减弱动态 / 系统静音 的替代反馈都依赖这里。
// 全部只读探测，不产生任何声音。

export interface Capabilities {
  /** 系统开启了"减弱动态效果"（iOS/macOS reduce-motion 等） */
  prefersReducedMotion: boolean;
  /** 当前浏览器/系统环境可能是静音的（无法 100% 检测，按启发式判断） */
  likelyMuted: boolean;
  /** 支持触觉反馈（移动端 navigator.vibrate） */
  haptics: boolean;
  /** 支持 AudioContext（含 Safari 的 webkit 前缀） */
  webAudio: boolean;
}

export function detectCapabilities(): Capabilities {
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 没有任何 Web API 能直接读取系统静音开关。
  // 启发式：移动设备 + 静音模式下通常仍允许 AudioContext 出声，
  // 真正"静音"的来源是用户主动在页面内关掉声音（由引擎状态管理），
  // 这里只暴露能力位，替代反馈同时提供视觉 + 触觉，不依赖判断是否静音。
  const haptics = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  const webAudio =
    typeof window !== 'undefined' &&
    (typeof window.AudioContext !== 'undefined' ||
      typeof (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        !== 'undefined');

  return { prefersReducedMotion, likelyMuted: false, haptics, webAudio };
}

/** 触觉反馈：静音或减弱动态时，它是"发声"的替代通道之一 */
export function hapticTap(pattern: number | number[] = 12) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // 部分环境（跨域 iframe）调用会抛错，静默忽略
  }
}
