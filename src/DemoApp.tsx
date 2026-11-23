import { todayKey } from '@/daily';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useChain, usePersona } from '@/mock/store';
import { ContestDetail } from '@/components/ContestDetail';
import { ContestList } from '@/components/ContestList';
import { CreateContest } from '@/components/CreateContest';
import { Header, type View } from '@/components/Header';
import { Practice } from '@/components/Practice';
import { WalletPanel } from '@/components/WalletPanel';

interface Route {
  view: View;
  contestId: number | null;
}

function readRoute(): Route {
  const p = new URLSearchParams(window.location.search);
  const c = Number(p.get('contest'));
  if (Number.isInteger(c) && c > 0) return { view: 'contest', contestId: c };
  const v = p.get('view');
  return { view: v === 'create' || v === 'wallet' || v === 'practice' ? v : 'list', contestId: null };
}

export default function DemoApp({ modeSwitch, onGoLive }: { modeSwitch?: ReactNode; onGoLive: () => void }) {
  const chain = useChain();
  const persona = usePersona();
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((next: Route) => {
    const q = next.view === 'contest' && next.contestId ? `?contest=${next.contestId}` : next.view === 'list' ? '' : `?view=${next.view}`;
    window.history.pushState(null, '', `${window.location.pathname}${q}`);
    setRoute(next);
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="min-h-dvh">
      <Header modeSwitch={modeSwitch} chain={chain} persona={persona} view={route.view} onView={(v) => go({ view: v, contestId: null })} />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8">
        {route.view === 'list' && (
          <ContestList
            chain={chain}
            onOpen={(id) => go({ view: 'contest', contestId: id })}
            onCreate={() => go({ view: 'create', contestId: null })}
            onStartPractice={() => go({ view: 'practice', contestId: null })}
            onOpenDaily={() => {
              window.history.pushState(null, '', `${window.location.pathname}?view=practice&daily=${todayKey()}`);
              setRoute({ view: 'practice', contestId: null });
              window.scrollTo({ top: 0 });
            }}
          />
        )}
        {route.view === 'contest' && route.contestId !== null && (
          <ContestDetail chain={chain} contestId={route.contestId} persona={persona} onBack={() => go({ view: 'list', contestId: null })} />
        )}
        {route.view === 'create' && (
          <CreateContest chain={chain} persona={persona} onCreated={(id) => go({ view: 'contest', contestId: id })} />
        )}
        {route.view === 'wallet' && <WalletPanel chain={chain} persona={persona} />}
        {route.view === 'practice' && <Practice onOpenLive={onGoLive} />}
      </main>
    </div>
  );
}
