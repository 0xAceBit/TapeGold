import { useEffect, useState } from 'react';
import { Check, Copy, Download, Share2 } from 'lucide-react';
import { renderShareCard, type CardInput } from '@/lib/shareCard';
import { buildShareLink } from '@/lib/share';

export type ShareTarget = { kind: 'level'; id: string } | { kind: 'daily'; id: string };

interface Props {
  /** Which puzzle a friend should open: a practice level id, or a daily puzzle date. */
  target: ShareTarget;
  card: CardInput;
}

/** Builds the link a friend opens, in the practice puzzle with your score to beat. Uses the share helper, never window.location. */
export function friendPath(target: Props['target'], gates: number): string {
  const key = target.kind === 'level' ? `level=${target.id}` : `daily=${target.id}`;
  return `/?view=practice&${key}&beat=${gates}`;
}

export function ShareButton({ target, card }: Props) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const path = friendPath(target, card.gates);

  // Resolve the shareable address once, then keep every action disabled until it is known.
  useEffect(() => {
    const ctl = { live: true };
    void buildShareLink(path).then((l) => {
      if (ctl.live) setLink(l);
    });
    return () => {
      ctl.live = false;
    };
  }, [path]);

  const who = card.name ? card.name : 'I';
  const text = `${who} solved ${card.title} in ${card.gates} ${card.gates === 1 ? 'brick' : 'bricks'} on TapeGold (best known: ${card.par}). Can you beat it?`;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setNote('Copy was blocked. Select the link and copy it by hand.');
    }
  };

  const save = async (): Promise<Blob | null> => {
    try {
      return await renderShareCard(card);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not make the picture.');
      return null;
    }
  };

  const download = async () => {
    const blob = await save();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tapegold-result.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const share = async () => {
    if (!link) return;
    try {
      const blob = await save();
      const file = blob ? new File([blob], 'tapegold-result.png', { type: 'image/png' }) : null;
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ title: 'TapeGold', text, url: link, files: [file] });
      else await navigator.share({ title: 'TapeGold', text, url: link });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setNote('Sharing was not possible here. Use Copy link instead.');
    }
  };

  const tweet = link ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}` : undefined;

  return (
    <div className="space-y-2" aria-label="Share your result">
      <div className="flex flex-wrap gap-2">
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button type="button" className="btn btn-primary btn-sm" disabled={!link} onClick={() => void share()}>
            <Share2 size={14} /> Share
          </button>
        )}
        <button type="button" className="btn btn-sm" disabled={!link} onClick={() => void copy()}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy challenge link'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void download()}>
          <Download size={14} /> Save picture
        </button>
        <a
          className={`btn btn-ghost btn-sm no-underline ${link ? '' : 'pointer-events-none opacity-45'}`}
          href={tweet}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!link}
        >
          Post on X
        </a>
      </div>
      {note && (
        <p className="text-xs" style={{ color: 'var(--danger)' }} role="alert">
          {note}
        </p>
      )}
    </div>
  );
}
