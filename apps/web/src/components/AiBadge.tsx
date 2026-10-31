import { Badge } from './ui';

/** Every AI/auto-generated artefact is marked until a human approves it. */
export function AiBadge({ aiGenerated, reviewStatus }: { aiGenerated: boolean; reviewStatus?: string }) {
  if (!aiGenerated || reviewStatus === 'Approved') return null;
  return <Badge color="amber">AI-generated – pending review</Badge>;
}
