import { useEffect, useRef } from 'react';
import type { VoicePlan } from '../../../shared/symphony';
import { CATEGORY_COLORS, type MicrobeCategory } from '../../../shared/types';

interface NotePulse {
  microbeId: number;
  born: number;
  tension: number;
  velocity: number;
  downbeat: boolean;
}

export interface LastNote {
  microbeId: number;
  tension: number;
  velocity: number;
  downbeat: boolean;
}

interface Props {
  voices: VoicePlan[];
  step: number;
  /** 每次发声自增（引擎 onNote 驱动），静音时也自增 */
  pulseTick: number;
  lastNote: LastNote | null;
  reducedMotion: boolean;
  muted: boolean;
}

function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 声部律动环：声部色点沿环分布，发声时扩散同色涟漪。
 * - 减弱动态：关闭位移/扩散动画，只做瞬时描边闪烁（非运动反馈）。
 * - 静音 / 无 Web Audio：涟漪与刻度照常运转（引擎 onNote 不依赖声音），
 *   配合 navigator.vibrate 构成替代反馈。
 */
export function SymphonyVisualizer({
  voices, step, pulseTick, lastNote, reducedMotion, muted,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pulsesRef = useRef<NotePulse[]>([]);
  const rafRef = useRef<number>(0);
  const stepRef = useRef(step);
  const reducedRef = useRef(reducedMotion);
  const mutedRef = useRef(muted);
  const voicesRef = useRef(voices);
  stepRef.current = step;
  reducedRef.current = reducedMotion;
  mutedRef.current = muted;
  voicesRef.current = voices;

  useEffect(() => {
    if (!lastNote || pulseTick === 0) return;
    pulsesRef.current.push({ born: performance.now(), ...lastNote });
    if (pulsesRef.current.length > 60) pulsesRef.current.shift();
  }, [pulseTick, lastNote]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let mounted = true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const colorOf = (id: number) => {
      const v = voicesRef.current.find((x) => x.microbeId === id);
      return CATEGORY_COLORS[(v?.category as MicrobeCategory) ?? 'bacteria'];
    };

    const draw = () => {
      if (!mounted) return;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const now = performance.now();
      ctx.clearRect(0, 0, w, h);

      const radius = Math.min(w, h) * 0.34;
      const n = Math.max(1, voicesRef.current.length);

      ctx.strokeStyle = 'rgba(0,255,200,0.12)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      for (let i = 0; i < 32; i += 1) {
        const a = (i / 32) * Math.PI * 2 - Math.PI / 2;
        const isBeat = i % 8 === 0;
        ctx.strokeStyle = i === stepRef.current
          ? 'rgba(0,255,200,0.9)'
          : isBeat ? 'rgba(0,255,200,0.35)' : 'rgba(0,255,200,0.14)';
        ctx.beginPath();
        ctx.moveTo(
          cx + Math.cos(a) * radius * (isBeat ? 0.93 : 0.97),
          cy + Math.sin(a) * radius * (isBeat ? 0.93 : 0.97),
        );
        ctx.lineTo(cx + Math.cos(a) * radius * 1.04, cy + Math.sin(a) * radius * 1.04);
        ctx.stroke();
      }

      // 发声涟漪
      pulsesRef.current = pulsesRef.current.filter((p) => now - p.born < 1100);
      for (const p of pulsesRef.current) {
        const idx = voicesRef.current.findIndex((v) => v.microbeId === p.microbeId);
        if (idx < 0) continue;
        const angle = (idx / n) * Math.PI * 2 - Math.PI / 2;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius;
        const age = (now - p.born) / 1100;
        const color = colorOf(p.microbeId);
        if (reducedRef.current) {
          if (age < 0.16) {
            ctx.strokeStyle = hexA(color, 0.9);
            ctx.lineWidth = 2 * dpr;
            ctx.beginPath();
            ctx.arc(px, py, 11 * dpr * (p.downbeat ? 1.4 : 1), 0, Math.PI * 2);
            ctx.stroke();
          }
        } else {
          const rr = (8 + age * 48 * (0.7 + p.tension)) * dpr;
          ctx.strokeStyle = hexA(color, (1 - age) * (0.4 + p.velocity * 0.5));
          ctx.lineWidth = (p.downbeat ? 2.4 : 1.2) * dpr;
          ctx.beginPath();
          ctx.arc(px, py, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // 声部色点
      voicesRef.current.forEach((v, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const bob = reducedRef.current
          ? 0
          : Math.sin((stepRef.current / 32) * Math.PI * 2 + i) * 4 * dpr;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius + bob;
        const color = colorOf(v.microbeId);
        const glow = ctx.createRadialGradient(px, py, 0, px, py, 16 * dpr);
        glow.addColorStop(0, hexA(color, 0.9));
        glow.addColorStop(1, hexA(color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(px, py, 16 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, 5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      });

      // 静音：中心静态虚线环（非动画），明确当前是视觉替代反馈
      if (mutedRef.current) {
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.52, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      mounted = false;
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="w-full aspect-square max-w-[420px]" />;
}
