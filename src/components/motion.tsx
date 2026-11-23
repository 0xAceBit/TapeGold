import { useEffect, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const EASE = [0.22, 1, 0.36, 1] as const;

/** Fades and lifts its content into place the first time it scrolls into view. Static for people who asked for less motion. */
export function Reveal({ children, delay = 0, y = 24, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** A headline whose words rise out of a mask one after another. `accent` words are set in the serif italic. */
export function RiseWords({ words, className, startDelay = 0.1 }: { words: Array<{ text: string; accent?: boolean; br?: boolean }>; className?: string; startDelay?: number }) {
  const reduce = useReducedMotion();
  return (
    <h1 className={className} aria-label={words.map((w) => w.text).join(' ')}>
      {words.map((w, i) => (
        <span key={`${w.text}-${i}`} aria-hidden>
          <span className="inline-block overflow-hidden pb-[0.12em] align-bottom">
            <motion.span
              className={`inline-block ${w.accent ? 'serif' : ''}`}
              initial={reduce ? false : { y: '110%' }}
              animate={{ y: 0 }}
              transition={{ duration: 0.8, delay: startDelay + i * 0.07, ease: EASE }}
            >
              {w.text}
            </motion.span>
          </span>
          {w.br ? <br /> : ' '}
        </span>
      ))}
    </h1>
  );
}

/** True once the page has scrolled a little. Used to give the header an edge only when content passes under it. */
export function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [threshold]);
  return scrolled;
}

/** A slow, endless ticker. Pauses on hover; static for people who asked for less motion. */
export function Marquee({ items }: { items: string[] }) {
  const row = (key: string) => (
    <div className="flex shrink-0 items-center" key={key} aria-hidden={key === 'b'}>
      {items.map((t) => (
        <span key={`${key}-${t}`} className="flex items-center">
          <span className="display px-6 text-2xl sm:text-3xl">{t}</span>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: '#d9b46a' }} aria-hidden />
        </span>
      ))}
    </div>
  );
  return (
    <div className="marquee overflow-hidden border-y py-4" style={{ borderColor: 'var(--border)' }} aria-label={items.join(', ')}>
      <div className="marquee-track">
        {row('a')}
        {row('b')}
      </div>
    </div>
  );
}
