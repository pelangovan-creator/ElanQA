import { useState } from 'react';
import { useProject } from '../lib/project';
import { PageHeader } from '../components/ui';
import { Tabs } from '../components/Tabs';
import { RunPanel } from './execution/RunPanel';
import { RunHistory } from './execution/RunView';
import { Environments } from './execution/Environments';
import { Scripts } from './execution/Scripts';

type Tab = 'run' | 'history' | 'environments' | 'scripts';

export function TestExecution() {
  const { current } = useProject();
  const [tab, setTab] = useState<Tab>('run');
  if (!current) return null;
  return (
    <>
      <PageHeader title="Test Execution" subtitle="Generate Playwright scripts from approved test cases, run them against an environment and watch results live. Manual cases use the guided screen." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'run', label: 'Run' }, { id: 'history', label: 'History' }, { id: 'environments', label: 'Environments' }, { id: 'scripts', label: 'Scripts' }]}>
        {tab === 'run' && <RunPanel />}
        {tab === 'history' && <RunHistory />}
        {tab === 'environments' && <Environments />}
        {tab === 'scripts' && <Scripts />}
      </Tabs>
    </>
  );
}
