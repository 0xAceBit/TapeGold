import { useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { Flag } from 'lucide-react';
import { Portrait } from './Portrait';

/** A real NAND gate you can poke: the lamp is on unless both switches are on. This is the only part you build with. */
function NandToy() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(true);
  const out = !(a && b);
  const sw = (on: boolean, set: (v: boolean) => void, label: string) => (
    <button
      type="button"
      onClick={() => set(!on)}
      aria-pressed={on}
      aria-label={`Switch ${label} is ${on ? 'on' : 'off'}. Click to flip.`}
      className="relative h-7 w-12 rounded-full transition-colors duration-300"
      style={{ background: on ? 'var(--ink)' : 'var(--border-strong)' }}
    >
      <span
        className="absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-300"
        style={{ transform: on ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  );
  return (
    <div className="card w-[248px] p-4" style={{ boxShadow: '0 18px 40px rgba(30,30,31,0.14)' }}>
      <div className="eyebrow">Try one brick</div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {sw(a, setA, 'A')}
            <span className="mono text-xs">A</span>
          </div>
          <div className="flex items-center gap-2">
            {sw(b, setB, 'B')}
            <span className="mono text-xs">B</span>
          </div>
        </div>
        <div className="display rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--surface-muted)' }}>
          NAND
        </div>
        <div className="flex flex-col items-center gap-1">
          <span
            className="block h-9 w-9 rounded-full transition-all duration-300"
            style={{
              background: out ? '#d9b46a' : 'var(--surface-muted)',
              boxShadow: out ? '0 0 0 4px rgba(217,180,106,0.25), 0 0 22px rgba(217,180,106,0.7)' : 'inset 0 0 0 1.5px var(--border-strong)',
            }}
            role="img"
            aria-label={`Lamp is ${out ? 'on' : 'off'}`}
          />
          <span className="mono text-[11px]" aria-hidden>
            {out ? 'on' : 'off'}
          </span>
        </div>
      </div>
      <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
        On unless both switches are on. Every puzzle here is built from this one brick.
      </p>
    </div>
  );
}

/** The portrait card with two floating cards that drift gently, and a slow parallax as the page scrolls. */
export function HeroVisual() {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const lift = useTransform(scrollY, [0, 600], [0, reduce ? 0 : -36]);
  const zoom = useTransform(scrollY, [0, 600], [1.04, reduce ? 1.04 : 1.12]);
  const float = (delay: number) =>
    reduce ? {} : { animate: { y: [0, -7, 0] }, transition: { duration: 6, delay, repeat: Infinity, ease: 'easeInOut' as const } };

  return (
    <motion.div
      className="relative mx-auto w-full max-w-[420px] lg:ml-auto lg:mr-0"
      initial={reduce ? false : { opacity: 0, y: 28, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.9, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div style={{ y: lift }}>
        <div className="tile relative aspect-[4/5] overflow-hidden" style={{ borderRadius: 28, boxShadow: '0 30px 60px rgba(30,30,31,0.12)' }}>
          <motion.div className="h-full w-full" style={{ scale: zoom }}>
            <Portrait />
          </motion.div>
        </div>

        <motion.div className="absolute -right-2 top-6 sm:-right-6" {...float(0.4)}>
          <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium" style={{ boxShadow: '0 12px 30px rgba(30,30,31,0.14)' }}>
            <Flag size={14} aria-hidden /> Fewest bricks wins
          </div>
        </motion.div>

        <motion.div className="absolute -bottom-6 -left-2 sm:-left-10" {...float(1.2)}>
          <NandToy />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
