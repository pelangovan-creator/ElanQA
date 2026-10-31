import { useState } from 'react';
import { useProject } from '../lib/project';
import { PageHeader } from '../components/ui';
import { Tabs } from '../components/Tabs';
import { Clarifications } from './artefacts/Clarifications';
import { Scenarios } from './artefacts/Scenarios';
import { TestCases } from './artefacts/TestCases';
import { TestDataTab } from './artefacts/TestDataTab';
import { DocTab } from './artefacts/DocTab';

type Tab = 'clarifications' | 'scenarios' | 'cases' | 'data' | 'techniques' | 'plan';

export function TestArtefacts() {
  const { current } = useProject();
  const [tab, setTab] = useState<Tab>('cases');
  if (!current) return null;
  return (
    <>
      <PageHeader title="Test Artefacts" subtitle="Generated from the requirement baseline. Everything is editable, goes through Approve / Reject, and exports to Excel, PDF and Word." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'clarifications', label: 'Clarification Log' }, { id: 'scenarios', label: 'Scenarios' }, { id: 'cases', label: 'Test Cases' },
        { id: 'data', label: 'Test Data' }, { id: 'techniques', label: 'Techniques' }, { id: 'plan', label: 'Test Plan' },
      ]}>
        {tab === 'clarifications' && <Clarifications />}
        {tab === 'scenarios' && <Scenarios />}
        {tab === 'cases' && <TestCases />}
        {tab === 'data' && <TestDataTab />}
        {tab === 'techniques' && <DocTab type="TestTechniques" name="Test Techniques Document" />}
        {tab === 'plan' && <DocTab type="TestPlan" name="Test Plan" />}
      </Tabs>
    </>
  );
}
