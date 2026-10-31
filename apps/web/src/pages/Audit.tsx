import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useProject } from '../lib/project';
import type { AuditItem } from '../lib/types';
import { Alert, Button, Card, PageHeader, Table } from '../components/ui';

export function Audit() {
  const { current, can } = useProject();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['audit', current?.id],
    queryFn: () => api<{ items: AuditItem[]; total: number }>(`/projects/${current!.id}/audit?take=200`),
    enabled: !!current && can('audit.view'),
  });
  if (!current) return null;
  if (!can('audit.view')) return <Alert kind="info">The audit trail is visible to Admins and QA Leads.</Alert>;

  return (
    <>
      <PageHeader title="Audit trail" subtitle={`Every change in ${current.name}: who, what and when (${q.data?.total ?? 0} ${q.data?.total === 1 ? "entry" : "entries"}).`} />
      <Card>
        <Table head={['When', 'Who', 'Action', 'Entity', '']} caption="Audit log">
          {q.data?.items.map((i) => (
            <Fragment key={i.id}>
              <tr>
                <td className="px-2 py-2 text-xs">{new Date(i.createdAt).toLocaleString()}</td>
                <td className="px-2 py-2">{i.user?.name ?? 'System'}</td>
                <td className="px-2 py-2 font-mono text-xs">{i.action}</td>
                <td className="px-2 py-2">{i.entityType} <span className="font-mono text-xs text-slate-500">{i.entityId}</span></td>
                <td className="px-2 py-2 text-right">{(i.before || i.after) && <Button variant="ghost" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>Details</Button>}</td>
              </tr>
              {open === i.id && (
                <tr><td colSpan={5} className="bg-slate-50 px-2 py-2">
                  <div className="grid gap-2 md:grid-cols-2">
                    <pre className="overflow-auto text-xs"><strong>Before</strong>{'\n'}{i.before ? JSON.stringify(JSON.parse(i.before), null, 2) : '—'}</pre>
                    <pre className="overflow-auto text-xs"><strong>After</strong>{'\n'}{i.after ? JSON.stringify(JSON.parse(i.after), null, 2) : '—'}</pre>
                  </div>
                </td></tr>
              )}
            </Fragment>
          ))}
        </Table>
      </Card>
    </>
  );
}
