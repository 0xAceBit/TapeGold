import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const COLORS = ['#d9b46a', '#1e1e1f', '#1a7f45', '#d6606b', '#e9d8a6'];

/** Small seeded generator so a burst always looks the same for the same number, and rendering stays pure. */
function rng(seed: number): () => number {
  let a = seed * 2654435761 + 12345;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A short fall of gold and ink pieces. Change `burst` (any new number above 0) to fire it again; `big` is for a perfect score.
 * Draws nothing for visitors who asked their device for reduced motion.
 */
export function Confetti({ burst, big = false }: { burst: number; big?: boolean }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (burst === 0) return;
    const show = setTimeout(() => setShown(burst), 0);
    const hide = setTimeout(() => setShown(0), 2800);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [burst]);

  if (reduce || shown === 0 || shown !== burst) return null;
  const rand = rng(burst);
  const pieces = Array.from({ length: big ? 64 : 30 }, (_, i) => ({
    key: i,
    left: 10 + rand() * 80,
    drift: (rand() - 0.5) * 360,
    spin: (rand() - 0.5) * 900,
    delay: rand() * 0.25,
    length: 1.7 + rand() * 1.1,
    size: 6 + rand() * 7,
    color: COLORS[Math.floor(rand() * COLORS.length)],
    round: rand() > 0.55,
  }));

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {pieces.map((p) => (
        <motion.span
          key={p.key}
          className="absolute top-0 block"
          style={{ left: `${p.left}%`, width: p.size, height: p.round ? p.size : p.size * 0.55, background: p.color, borderRadius: p.round ? 999 : 2 }}
          initial={{ y: -24, x: 0, rotate: 0, opacity: 1 }}
          animate={{ y: '105vh', x: p.drift, rotate: p.spin, opacity: [1, 1, 0] }}
          transition={{ duration: p.length, delay: p.delay, ease: [0.2, 0.7, 0.4, 1] }}
        />
      ))}
    </div>
  );
}
