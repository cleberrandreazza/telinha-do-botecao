import { topologyView, type RelayPlan, type TopologyView } from './relayPath.ts';

let current: TopologyView = topologyView(null, false);
const listeners = new Set<() => void>();

export function getRelayTopology(): TopologyView {
  return current;
}

export function subscribeRelayTopology(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setRelayTopology(plan: RelayPlan | null, active: boolean) {
  const next = topologyView(plan, active);
  if (next.mode === current.mode && next.text === current.text && next.relayNodeId === current.relayNodeId) return;
  current = next;
  for (const listener of listeners) listener();
}
