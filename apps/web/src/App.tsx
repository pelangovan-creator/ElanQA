import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { ProjectProvider } from './lib/project';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Projects } from './pages/Projects';
import { Users } from './pages/Users';
import { Audit } from './pages/Audit';
import { Requirements } from './pages/Requirements';
import { TestArtefacts } from './pages/TestArtefacts';
import { TestExecution } from './pages/TestExecution';
import { RunView } from './pages/execution/RunView';
import { ManualRun } from './pages/execution/ManualRun';
import { Defects } from './pages/Defects';
import { DefectDetail } from './pages/DefectDetail';
import { Monitoring } from './pages/Monitoring';
import { Reports } from './pages/Reports';
import { Closure } from './pages/Closure';

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <p role="status" className="p-6">Loading…</p>;
  if (!user) return <Login />;
  return (
    <ProjectProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="projects" element={<Projects />} />
          <Route path="audit" element={<Audit />} />
          <Route path="requirements" element={<Requirements />} />
          <Route path="artefacts" element={<TestArtefacts />} />
          <Route path="execution" element={<TestExecution />} />
          <Route path="execution/runs/:runId" element={<RunView />} />
          <Route path="execution/manual/:runId" element={<ManualRun />} />
          <Route path="defects" element={<Defects />} />
          <Route path="defects/:id" element={<DefectDetail />} />
          <Route path="monitoring" element={<Monitoring />} />
          <Route path="reports" element={<Reports />} />
          <Route path="closure" element={<Closure />} />
          {user.role === 'Admin' && <Route path="users" element={<Users />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ProjectProvider>
  );
}
