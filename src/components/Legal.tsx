import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Brand } from './Brand';

export type LegalKind = 'terms' | 'privacy';

const UPDATED = 'November 26, 2026';
const CONTACT = 'https://github.com/0xAceBit/TapeGold/issues';

/** Which legal page the address asks for (#/terms or #/privacy), if any. Works in demo and live mode alike. */
export function useLegalKind(): LegalKind | null {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    () => {
      const h = window.location.hash;
      return h === '#/terms' ? 'terms' : h === '#/privacy' ? 'privacy' : null;
    },
    () => null,
  );
}

/** Small links shown at the bottom of every screen. */
export function LegalFooter() {
  return (
    <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
      <span>TapeGold is open source (MIT). Not financial advice. Prizes can be lost.</span>
      <nav aria-label="Legal" className="flex gap-4">
        <a className="navlink" href="#/terms">
          Terms of Service
        </a>
        <a className="navlink" href="#/privacy">
          Privacy Policy
        </a>
      </nav>
    </footer>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="display text-xl">{title}</h2>
      <div className="space-y-2 text-pretty" style={{ color: 'var(--ink-2)' }}>
        {children}
      </div>
    </section>
  );
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function Terms() {
  return (
    <>
      <p>
        These terms cover your use of the TapeGold website and the circuit-golf challenges it shows. By using the site you agree to them. If you do not agree, please do not use it.
      </p>
      <Section title="1. What TapeGold is">
        <p>
          TapeGold is an open-source website that lets people play circuit puzzles and, if they choose, enter prize challenges run by a smart contract on X Layer. The site is an interface. It is not a bank, an exchange, a broker or a casino, and it never holds your money or your keys.
        </p>
        <p>In these terms, "we" and "us" mean the people who maintain the TapeGold project.</p>
      </Section>
      <Section title="2. Who may use it">
        <List
          items={[
            'You must be at least 18, or the age of majority where you live if that is higher.',
            'You must be allowed by the laws that apply to you to use it. Prize contests, token transfers and winnings may be regulated or taxed where you live. Working that out is your responsibility.',
            'Do not use the site if you are subject to sanctions or if using it would be unlawful for you.',
          ]}
        />
      </Section>
      <Section title="3. Practice and demo mode">
        <p>Practice puzzles, the daily puzzle and demo data are free, have no prizes and involve no real money. Demo players, demo clocks and demo balances are not real.</p>
      </Section>
      <Section title="4. Live challenges">
        <List
          items={[
            'A sponsor puts a prize into the contract. Players seal an entry (commit), open it later (reveal), and the contract picks the winner by gate count, with the earliest entry winning ties. The winner withdraws the prize, minus a fee set when the contract was deployed.',
            'If nobody reveals a valid circuit, the sponsor can take back what they put in, and others take back their top-ups.',
            'Blockchain transactions are final. We cannot reverse, cancel or refund them. Each one costs network fees and, for some actions, TapeOut fees. You pay these.',
            'Anyone can create a challenge with any token and any processor. We do not review, rank or endorse challenges. Check the token address and the rules of a challenge before you put money in.',
            'A sponsor can enter their own challenge. Top-ups go to whoever wins.',
          ]}
        />
      </Section>
      <Section title="5. Your wallet, your keys, your backup">
        <p>
          You connect your own wallet. We cannot see your private keys, recover your wallet, or move your funds. When you commit, the site creates a secret code (the salt) in your browser and asks you to save a backup file. If you lose the salt, your entry cannot be revealed and cannot be recovered by anyone, including us. Keep the backup file private.
        </p>
      </Section>
      <Section title="6. Risks you accept">
        <List
          items={[
            'The contract has not had a professional security audit. It may contain bugs that lose funds.',
            'A commit is tied to a circuit id, not to the circuit\u2019s contents. A copier can match your gate count and win a tie by committing earlier. The lowest unique gate count is not affected.',
            'The site relies on things we do not control: the TapeOut protocol (which its owner can upgrade), X Layer, public RPC services, your wallet, and the prize token. Any of them can fail, change, be attacked or be shut down.',
            'Tokens can be fake, can charge fees on transfer, or can be frozen by their issuer. A token called "USDC" is not necessarily the real one.',
            'Networks can be slow or congested, and transactions can fail.',
            'Only use amounts you can afford to lose.',
          ]}
        />
        <p>Nothing on the site is financial, investment, legal or tax advice.</p>
      </Section>
      <Section title="7. Acceptable use">
        <p>Do not attack or overload the site or the networks it uses, try to cheat other players through bugs or by abusing the contract in ways that break its rules for others, use the site for anything unlawful, or pretend to be someone else.</p>
      </Section>
      <Section title="8. Open source and ownership">
        <p>
          The TapeGold code is released under the MIT License, which you can read in the project repository. Names and logos of other products, networks and wallets belong to their owners. The results you create (such as circuits you design) remain yours; circuits placed on a public blockchain are public.
        </p>
      </Section>
      <Section title="9. No warranty">
        <p>
          The site and the contract are provided "as is" and "as available", without warranties of any kind, whether express or implied, including fitness for a particular purpose, accuracy, availability and non-infringement.
        </p>
      </Section>
      <Section title="10. Limit of liability">
        <p>
          To the fullest extent the law allows, the maintainers of TapeGold are not liable for any loss or damage that comes from using the site or the contract, including lost funds, lost entries, lost prizes, failed or mistaken transactions, third-party failures, or lost profits. Nothing here limits any right you have by law that cannot be limited.
        </p>
      </Section>
      <Section title="11. Changes and ending">
        <p>
          We may change the site, these terms or take the site down at any time. The smart contract is separate: once deployed it keeps running on the blockchain whether or not this website exists. We will change the date above when the terms change, and using the site afterwards means you accept the new version.
        </p>
      </Section>
      <Section title="12. Governing law and contact">
        <p>
          These terms are governed by the law of the place where the project&rsquo;s maintainer is based, unless the consumer law where you live says otherwise. To report a problem or ask a question, open an issue at{' '}
          <a className="link" href={CONTACT} target="_blank" rel="noopener noreferrer">
            the project repository
          </a>
          .
        </p>
      </Section>
    </>
  );
}

function Privacy() {
  return (
    <>
      <p>
        The short version: TapeGold has no accounts, no analytics, no advertising and no server of its own. We do not collect your personal data. The sections below explain what stays on your device and what other services can see.
      </p>
      <Section title="1. What we collect">
        <p>Nothing. The site runs entirely in your browser and does not send information to a TapeGold server. We do not set cookies.</p>
      </Section>
      <Section title="2. What is saved on your device">
        <p>The site saves a few things in your browser&rsquo;s local storage so the game remembers you:</p>
        <List
          items={[
            'Your practice progress, stars, daily-puzzle history and streak.',
            'Your optional name for share pictures, your sound setting, whether the how-to card is open, and whether you chose demo or live mode.',
            'For live entries: the circuit id, salt and wallet address of entries you commit, and a record of the last wallet connection. The salt works like a password for your entry, so treat this browser as sensitive.',
            'A cache of reveal events already read from the blockchain, so pages load faster.',
          ]}
        />
        <p>
          Clearing your browser data erases all of this. If you also clear it before saving the backup file, a live entry cannot be recovered. Backup files you download are yours and are not sent anywhere.
        </p>
      </Section>
      <Section title="3. What other services can see">
        <List
          items={[
            <>
              <strong>Hosting.</strong> The site is delivered by a hosting provider (Vercel). Like any web host, it can record technical details of each visit, such as your IP address and browser type, under its own privacy policy.
            </>,
            <>
              <strong>The X Layer network.</strong> To show challenges the page reads the blockchain through a public RPC service (rpc.xlayer.tech). That service can see your IP address and which contracts and addresses are queried.
            </>,
            <>
              <strong>Your wallet.</strong> If you connect OKX Wallet or another wallet, that wallet&rsquo;s own privacy policy applies to what it does.
            </>,
            <>
              <strong>Sharing.</strong> The share picture is drawn on your device. Nothing is shared until you press a share button. &ldquo;Post on X&rdquo; opens X with your text and link, and your device&rsquo;s share sheet passes them to the app you choose. Those services have their own policies.
            </>,
            <>
              <strong>Explorer links.</strong> Links to OKLink open another website, which has its own policy.
            </>,
          ]}
        />
        <p>Fonts and images are bundled with the site, so no font or image service is contacted.</p>
      </Section>
      <Section title="4. Blockchain data is public and permanent">
        <p>
          When you send a transaction (create, commit, reveal, top up, withdraw), your wallet address, the amount, the circuit id and the result are recorded on a public blockchain. Anyone can read them and they cannot be deleted or changed, by us or anyone else. Do not use a wallet you want to keep private.
        </p>
      </Section>
      <Section title="5. Your choices">
        <List
          items={[
            'Use practice and demo mode with no wallet at all.',
            'Clear the site data in your browser to remove everything it stored.',
            'Disconnect your wallet from the site in your wallet app.',
            'Use a VPN or private browsing if you do not want your IP address tied to your visits.',
          ]}
        />
      </Section>
      <Section title="6. Children">
        <p>TapeGold is not meant for anyone under 18, and we do not knowingly collect information from children.</p>
      </Section>
      <Section title="7. Changes and contact">
        <p>
          We will update the date above when this policy changes. Questions or requests can be sent by opening an issue at{' '}
          <a className="link" href={CONTACT} target="_blank" rel="noopener noreferrer">
            the project repository
          </a>
          . Because we hold no personal data, there is nothing for us to look up or delete, but we will help where we can.
        </p>
      </Section>
    </>
  );
}

/** Full-page Terms of Service or Privacy Policy. */
export function LegalPage({ kind }: { kind: LegalKind }) {
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = `${kind === 'terms' ? 'Terms of Service' : 'Privacy Policy'} | TapeGold`;
    return () => {
      document.title = 'TapeGold: golf a circuit, win the pot';
    };
  }, [kind]);

  const back = () => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  return (
    <div className="min-h-dvh">
      <header className="border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
          <Brand small />
          <button type="button" className="btn btn-sm" onClick={back}>
            <ArrowLeft size={14} aria-hidden /> Back to TapeGold
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 pb-24 pt-10">
        <div>
          <span className="eyebrow">Legal</span>
          <h1 className="display text-4xl text-balance">{kind === 'terms' ? 'Terms of Service' : 'Privacy Policy'}</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Last updated {UPDATED}
          </p>
        </div>
        <nav aria-label="Legal pages" className="flex gap-2">
          <a className={`btn btn-sm ${kind === 'terms' ? 'btn-primary' : ''}`} href="#/terms" aria-current={kind === 'terms' ? 'page' : undefined}>
            Terms of Service
          </a>
          <a className={`btn btn-sm ${kind === 'privacy' ? 'btn-primary' : ''}`} href="#/privacy" aria-current={kind === 'privacy' ? 'page' : undefined}>
            Privacy Policy
          </a>
        </nav>
        <article className="space-y-6 text-[15px] leading-relaxed">{kind === 'terms' ? <Terms /> : <Privacy />}</article>
        <p className="rounded-xl p-4 text-sm" style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}>
          This page is a plain-language summary written for an open-source project. It is not legal advice.
        </p>
      </main>
    </div>
  );
}
