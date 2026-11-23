import { useEffect, useState } from 'react';
import DemoApp from './DemoApp';
import { ModeSwitch } from './components/ModeSwitch';
import { LiveApp } from './arena/LiveApp';
import { loadConfig, type ArenaConfig } from './arena/config';
import { useMode } from './mode';
import { usePractice } from './practice';

/**
 * TapeGold. The full site is always visible: with no contract configured it runs on demo data (the in-browser model), and
 * once a contract address is configured it opens on live X Layer data. The switch in the header changes between the two.
 */
export default function App() {
  const [config, setConfig] = useState<ArenaConfig | null>(null);
  useEffect(() => {
    void loadConfig().then(setConfig);
  }, []);
  const liveReady = !!config?.arena;
  const practice = usePractice();
  // Live opens by default only for people who have finished (or skipped) the practice puzzles.
  const [chosen, setMode] = useMode(liveReady && practice.done);
  const mode = chosen === 'live' && !practice.done ? 'demo' : chosen;

  if (!config) return <div className="min-h-dvh" aria-busy="true" />;
  const goPractice = () => {
    setMode('demo');
    window.history.pushState(null, '', '?view=practice');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const modeSwitch = <ModeSwitch mode={mode} liveReady={liveReady} liveLocked={!practice.done} onLockedClick={goPractice} onChange={setMode} />;
  return mode === 'live' ? <LiveApp config={config} modeSwitch={modeSwitch} /> : <DemoApp modeSwitch={modeSwitch} onGoLive={() => setMode('live')} />;
}
