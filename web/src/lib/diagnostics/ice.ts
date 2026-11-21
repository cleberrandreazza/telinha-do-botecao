import type { IceRoute, IceSelectionSource, NetworkMetrics, StatsReportLike } from './types.ts';
import { readNumber, readString } from './read.ts';

const DIRECT_TYPES = new Set(['host', 'srflx', 'prflx']);

export function classifyRoute(localType: string | null, remoteType: string | null): IceRoute {
  if (localType === 'relay' || remoteType === 'relay') return 'relay';
  if (localType && remoteType && DIRECT_TYPES.has(localType) && DIRECT_TYPES.has(remoteType)) {
    return 'direct';
  }
  return 'unknown';
}

function pairCandidates(
  pair: StatsReportLike,
  byId: Map<string, StatsReportLike>,
): { local: StatsReportLike | null; remote: StatsReportLike | null } {
  const localId = readString(pair, 'localCandidateId');
  const remoteId = readString(pair, 'remoteCandidateId');
  return {
    local: localId ? byId.get(localId) ?? null : null,
    remote: remoteId ? byId.get(remoteId) ?? null : null,
  };
}

/**
 * Par ICE efetivamente selecionado.
 * Não escolhe um candidate-pair só porque state === 'succeeded'.
 * Ordem: transport.selectedCandidatePairId, candidate-pair.selected, um único nominated+succeeded.
 */
export function selectNetwork(reports: StatsReportLike[]): NetworkMetrics {
  const byId = new Map(reports.map((report) => [report.id, report]));
  const empty: NetworkMetrics = {
    rttMs: null,
    route: 'unknown',
    localCandidateType: null,
    remoteCandidateType: null,
    protocol: null,
    availableOutgoingBitrate: null,
    availableIncomingBitrate: null,
    selectedPairId: null,
    selection: 'none',
  };

  let pair: StatsReportLike | null = null;
  let selection: IceSelectionSource = 'none';

  for (const report of reports) {
    if (report.type !== 'transport') continue;
    const selectedId = readString(report, 'selectedCandidatePairId');
    if (selectedId && byId.has(selectedId)) {
      pair = byId.get(selectedId) ?? null;
      selection = 'transport';
      break;
    }
  }

  if (!pair) {
    const selected = reports.filter((report) => report.type === 'candidate-pair' && report.selected === true);
    if (selected.length === 1) {
      pair = selected[0];
      selection = 'selected';
    }
  }

  if (!pair) {
    const nominated = reports.filter((report) => (
      report.type === 'candidate-pair' && report.nominated === true && report.state === 'succeeded'
    ));
    if (nominated.length === 1) {
      pair = nominated[0];
      selection = 'nominated';
    }
  }

  if (!pair) return empty;

  const { local, remote } = pairCandidates(pair, byId);
  const localType = local ? readString(local, 'candidateType') : null;
  const remoteType = remote ? readString(remote, 'candidateType') : null;
  const protocol = (local && (readString(local, 'protocol') ?? readString(local, 'relayProtocol')))
    ?? (remote ? readString(remote, 'protocol') : null);
  const rttSec = readNumber(pair, 'currentRoundTripTime');

  return {
    rttMs: rttSec === null ? null : rttSec * 1000,
    route: classifyRoute(localType, remoteType),
    localCandidateType: localType,
    remoteCandidateType: remoteType,
    protocol,
    availableOutgoingBitrate: readNumber(pair, 'availableOutgoingBitrate'),
    availableIncomingBitrate: readNumber(pair, 'availableIncomingBitrate'),
    selectedPairId: pair.id,
    selection,
  };
}
