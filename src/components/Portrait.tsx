import { useEffect, useState } from 'react';

/**
 * The hero portrait and the small round picture beside the wordmark.
 *
 * Both are drawn here as vector art, so they are crisp at any size and add no image download. To use a real photo instead,
 * put it at public/hero.jpg: the page checks for it and shows it in both places.
 */
const PHOTO = './hero.jpg';

function usePhoto(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setOk(true);
    img.src = PHOTO;
  }, []);
  return ok;
}

/** viewBox: the whole picture, or a square crop on the face for the small round picture. */
function Art({ crop, idp }: { crop: boolean; idp: string }) {
  const id = (n: string) => `${idp}-${n}`;
  return (
    <svg
      viewBox={crop ? '100 96 200 200' : '0 0 400 500'}
      preserveAspectRatio="xMidYMid slice"
      className="block h-full w-full"
      role="img"
      aria-label="Illustration of a woman in dark sunglasses and a black blazer"
    >
      <defs>
        <linearGradient id={id('bg')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f1ea" />
          <stop offset="1" stopColor="#e3dfd6" />
        </linearGradient>
        <radialGradient id={id('halo')} cx="0.5" cy="0.42" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('skin')} x1="0.2" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#fbe6d6" />
          <stop offset="1" stopColor="#f1c9b0" />
        </linearGradient>
        <linearGradient id={id('hair')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5a3c2e" />
          <stop offset="1" stopColor="#2c1d18" />
        </linearGradient>
        <linearGradient id={id('lens')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a3a40" />
          <stop offset="1" stopColor="#0d0d0f" />
        </linearGradient>
        <linearGradient id={id('blazer')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2a2c" />
          <stop offset="1" stopColor="#151516" />
        </linearGradient>
        <clipPath id={id('face')}>
          <path d="M200 108 C140 108 126 172 132 214 C138 262 166 306 200 310 C234 306 262 262 268 214 C274 172 260 108 200 108 Z" />
        </clipPath>
      </defs>
      <rect width="400" height="500" fill={`url(#${id('bg')})`} />
      <circle cx="200" cy="215" r="190" fill={`url(#${id('halo')})`} />
      {!crop && (
        <>
          <circle cx="318" cy="96" r="22" fill="#d9b46a" opacity="0.9" />
          <circle cx="86" cy="150" r="9" fill="#1e1e1f" opacity="0.8" />
        </>
      )}
      <path d="M104 236 C92 150 128 76 200 76 C272 76 308 150 296 236 C292 296 304 350 286 400 L114 400 C96 350 108 296 104 236 Z" fill={`url(#${id('hair')})`} />
      <path d="M30 500 C34 408 108 360 200 356 C292 360 366 408 370 500 Z" fill={`url(#${id('blazer')})`} />
      <path d="M168 290 C168 336 164 358 148 372 L200 436 L252 372 C236 358 232 336 232 290 Z" fill={`url(#${id('skin')})`} />
      <ellipse cx="200" cy="318" rx="34" ry="13" fill="#c98f74" opacity="0.2" />
      <path d="M148 372 L200 436 L252 372 L270 500 L130 500 Z" fill="#fafafa" />
      <path d="M148 372 L200 436 L252 372" fill="none" stroke="#e8e8e8" strokeWidth="2" />
      <path d="M148 372 L112 384 L84 500 L134 500 L172 420 Z" fill="#1b1b1c" />
      <path d="M252 372 L288 384 L316 500 L266 500 L228 420 Z" fill="#1b1b1c" />
      <path d="M170 384 Q200 408 230 384" fill="none" stroke="#d9b46a" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="200" cy="404" r="3.4" fill="#d9b46a" />
      <ellipse cx="130" cy="228" rx="9" ry="16" fill="#f1c9b0" />
      <ellipse cx="270" cy="228" rx="9" ry="16" fill="#f1c9b0" />
      <circle cx="129" cy="250" r="5.5" fill="#d9b46a" />
      <circle cx="271" cy="250" r="5.5" fill="#d9b46a" />
      <path d="M200 108 C140 108 126 172 132 214 C138 262 166 306 200 310 C234 306 262 262 268 214 C274 172 260 108 200 108 Z" fill={`url(#${id('skin')})`} />
      <g clipPath={`url(#${id('face')})`}>
        <ellipse cx="256" cy="250" rx="46" ry="90" fill="#d9a285" opacity="0.18" />
        <circle cx="156" cy="252" r="20" fill="#f19a96" opacity="0.28" />
        <circle cx="244" cy="252" r="20" fill="#f19a96" opacity="0.28" />
      </g>
      <path d="M200 206 C198 228 191 242 195 249 C199 254 207 253 209 248" fill="none" stroke="#dcae95" strokeWidth="2.2" strokeLinecap="round" />
      <ellipse cx="200" cy="251" rx="13" ry="3.2" fill="#e9bba3" opacity="0.5" />
      <path d="M177 274 C188 266 197 270 200 272 C203 270 212 266 223 274 C215 290 185 290 177 274 Z" fill="#d6606b" />
      <path d="M177 274 Q200 279 223 274" fill="none" stroke="#a8404c" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M186 281 Q200 287 214 281" fill="none" stroke="#f08a93" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
      <path d="M132 190 C130 118 168 90 206 92 C252 94 274 128 268 190 C256 148 222 122 182 130 C152 136 138 156 132 190 Z" fill={`url(#${id('hair')})`} />
      <path d="M148 140 C170 112 214 104 246 122" fill="none" stroke="#8a6350" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
      <path d="M136 170 C140 152 150 140 164 132" fill="none" stroke="#8a6350" strokeWidth="2.4" strokeLinecap="round" opacity="0.45" />
      <path d="M136 190 C136 177 150 172 168 172 L188 174 C197 176 198 187 195 198 C191 216 176 224 160 221 C145 218 136 206 136 190 Z" fill={`url(#${id('lens')})`} stroke="#0b0b0c" strokeWidth="4" strokeLinejoin="round" />
      <path d="M264 190 C264 177 250 172 232 172 L212 174 C203 176 202 187 205 198 C209 216 224 224 240 221 C255 218 264 206 264 190 Z" fill={`url(#${id('lens')})`} stroke="#0b0b0c" strokeWidth="4" strokeLinejoin="round" />
      <path d="M195 184 Q200 179 205 184" fill="none" stroke="#0b0b0c" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M137 188 L127 184 M263 188 L273 184" stroke="#0b0b0c" strokeWidth="4" strokeLinecap="round" />
      <path d="M147 184 L168 180 L158 198 Z" fill="#fff" opacity="0.13" />
      <path d="M253 184 L232 180 L242 198 Z" fill="#fff" opacity="0.13" />
      <path d="M150 208 Q166 218 182 210" fill="none" stroke="#fff" strokeWidth="1.6" opacity="0.18" strokeLinecap="round" />
    </svg>
  );
}

/** The large hero picture. Fills its parent. */
export function Portrait() {
  const photo = usePhoto();
  return photo ? (
    <img src={PHOTO} alt="" className="block h-full w-full object-cover" />
  ) : (
    <Art crop={false} idp="hero" />
  );
}

/** The small round picture beside the wordmark: a close crop of the same portrait, with a gold dot. */
export function Avatar({ size = 36 }: { size?: number }) {
  const photo = usePhoto();
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <span
        className="block overflow-hidden rounded-full"
        style={{ width: size, height: size, boxShadow: '0 0 0 2px #fff, 0 0 0 3px var(--border), 0 6px 14px rgba(30,30,31,0.14)' }}
      >
        {photo ? <img src={PHOTO} alt="" className="block h-full w-full object-cover" style={{ objectPosition: '50% 22%' }} /> : <Art crop idp="nav" />}
      </span>
      <span className="absolute -bottom-0.5 -right-0.5 block rounded-full" style={{ width: size * 0.28, height: size * 0.28, background: '#d9b46a', boxShadow: '0 0 0 2px #fff' }} aria-hidden />
    </span>
  );
}
