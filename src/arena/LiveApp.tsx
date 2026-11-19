import { useEffect, useState, type ReactNode } from 'react';
import { ChallengeDetail } from './components/ChallengeDetail';
import { ChallengeList } from './components/ChallengeList';
import { CommitFlow } from './components/CommitFlow';
import { RevealFlow } from './components/RevealFlow';
import { Shell } from './components/Shell';
import { Unconfigured } from './components/Unconfigured';
import type { ArenaConfig } from './config';

type Route = { name: 'list' } | { name: 'detail'; id: number } | { name: 'commit'; id: number } | { name: 'reveal'; id: number };

/** Hash routes, so the site works from any static host or gateway path with no server rewrites. */
function parse(hash: string): Route {
  const m = /^#\/c\/(\d+)(?:\/(commit|reveal))?$/.exec(hash);
  if (!m) return { name: 'list' };
  const id = Number(m[1]);
  return m[2] === 'commit' ? { name: 'commit', id } : m[2] === 'reveal' ? { name: 'reveal', id } : { name: 'detail', id };
}

export function LiveApp({ config, modeSwitch }: { config: ArenaConfig; modeSwitch: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));

  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const arena = config.arena;
  return (
    <Shell config={config} modeSwitch={modeSwitch}>
      {!arena ? (
        <Unconfigured />
      ) : route.name === 'list' ? (
        <ChallengeList arena={arena} />
      ) : route.name === 'detail' ? (
        <ChallengeDetail arena={arena} id={route.id} />
      ) : route.name === 'commit' ? (
        <CommitFlow arena={arena} id={route.id} />
      ) : (
        <RevealFlow arena={arena} id={route.id} />
      )}
    </Shell>
  );
}
