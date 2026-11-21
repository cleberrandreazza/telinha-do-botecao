import { useState, type ReactNode } from 'react';
import {
  diagnosisSummary,
  effectiveResolution,
  formatBitrate,
  formatMeasuredFps,
  formatOptional,
  fpsColor,
  pipelineFps,
  routeLabel,
  UNAVAILABLE_LABEL,
  type ChartPoint,
  type DiagnosisState,
  type DiagnosticsSnapshot,
  type MetricSample,
  type PlaybackSample,
} from '../lib/diagnostics/index';

interface StatsPanelProps {
  snapshot: DiagnosticsSnapshot | null;
  /** FPS de track.getSettings(), só como valor solicitado. Nunca substitui o medido. */
  trackRequestedFps?: number | null;
  livePlayback?: PlaybackSample | null;
  onClose: () => void;
  onExport: () => void;
  connections?: { connectionId: string; label: string }[];
  selectedConnectionId?: string | null;
  onSelectConnection?: (connectionId: string) => void;
  emptyHint?: string;
}

export default function StatsPanel({
  snapshot,
  trackRequestedFps = null,
  livePlayback = null,
  onClose,
  onExport,
  connections,
  selectedConnectionId,
  onSelectConnection,
  emptyHint,
}: StatsPanelProps) {
  const [view, setView] = useState<'summary' | 'technical'>('summary');
  const sample = snapshot?.sample ?? null;
  const measured = sample ? pipelineFps(sample) : null;
  const livePresented = livePlayback && livePlayback.api !== 'none' ? livePlayback.presentedFps : null;
  const fps = {
    requested: measured?.requested ?? null,
    source: measured?.source ?? null,
    encoded: measured?.encoded ?? null,
    received: measured?.received ?? null,
    decoded: measured?.decoded ?? null,
    presented: measured?.presented ?? livePresented,
  };
  const requested = sample?.configuredFps ?? trackRequestedFps;
  const requestedLabel = sample?.configuredFps != null ? 'Solicitado' : 'Solicitado (track)';
  const resolution = sample ? effectiveResolution(sample) : { width: null, height: null };
  const diagnosis = snapshot?.diagnosis ?? null;
  const summary = diagnosis ? diagnosisSummary(diagnosis) : 'Dados insuficientes para diagnóstico';

  return (
    <div className="bg-black/85 backdrop-blur-xl border border-white/10 rounded-xl p-3 shadow-2xl text-[11px] font-label-mono text-[#dbdee1] flex flex-col gap-1.5 min-w-[250px] max-w-[340px] max-h-[min(72vh,580px)] overflow-y-auto">
      <div className="flex items-center justify-between gap-3 pb-1 border-b border-white/10">
        <span className="text-[10px] uppercase tracking-wider text-primary font-bold">Estatísticas</span>
        <div className="flex items-center gap-1">
          <ToggleButton active={view === 'summary'} onClick={() => setView('summary')}>Resumo</ToggleButton>
          <ToggleButton active={view === 'technical'} onClick={() => setView('technical')}>Técnico</ToggleButton>
          <button className="text-white/60 hover:text-white cursor-pointer ml-1" onClick={onClose} title="Fechar">
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      </div>

      {connections && connections.length > 1 && onSelectConnection && (
        <select
          className="bg-black/40 border border-white/10 rounded-md px-1.5 py-1 text-[11px]"
          value={selectedConnectionId ?? ''}
          onChange={(event) => onSelectConnection(event.target.value)}
        >
          {connections.map((connection) => (
            <option key={connection.connectionId} value={connection.connectionId}>{connection.label}</option>
          ))}
        </select>
      )}

      <div className="flex flex-col gap-0.5">
        <span className={`font-semibold ${stateClass(diagnosis?.state ?? 'INDETERMINADO')}`}>{summary}</span>
        {diagnosis && (
          <span className="text-white/55 leading-snug">
            {diagnosis.state} · confiança {diagnosis.confidence}
            {diagnosis.reason ? ` · ${diagnosis.reason}` : ''}
          </span>
        )}
        {!snapshot && emptyHint && <span className="text-white/55 leading-snug">{emptyHint}</span>}
      </div>

      {view === 'summary' ? (
        <Summary
          sample={sample}
          fps={fps}
          requested={requested}
          requestedLabel={requestedLabel}
          resolution={resolution}
          adaptiveState={snapshot?.adaptiveState ?? null}
          viewerCount={sample?.viewerCount ?? null}
        />
      ) : (
        <Technical
          sample={sample}
          chart={snapshot?.chart ?? []}
          events={snapshot?.recentEvents ?? []}
          livePlayback={livePlayback}
        />
      )}

      <button
        onClick={onExport}
        disabled={!snapshot}
        className="mt-1 h-7 rounded-lg border border-white/15 hover:bg-white/10 text-white disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
      >
        Exportar JSON
      </button>
    </div>
  );
}

function Summary({
  sample,
  fps,
  requested,
  requestedLabel,
  resolution,
  adaptiveState,
  viewerCount,
}: {
  sample: MetricSample | null;
  fps: ReturnType<typeof pipelineFps> | null;
  requested: number | null;
  requestedLabel: string;
  resolution: { width: number | null; height: number | null };
  adaptiveState: string | null;
  viewerCount: number | null;
}) {
  const sender = sample?.role === 'sender';
  const bitrate = sender ? sample?.outbound?.bitrate ?? null : sample?.inbound?.bitrate ?? null;
  const loss = sender ? sample?.remoteInbound?.lossPct ?? null : sample?.inbound?.lossPct ?? null;
  const jitter = sender ? sample?.remoteInbound?.jitterMs ?? null : sample?.inbound?.jitterMs ?? null;
  const ref = requested;
  return (
    <div className="flex flex-col gap-1">
      <FpsRow label={requestedLabel} value={requested} color="text-white/80" />
      <FpsRow label="Origem" value={fps?.source ?? null} color={fpsColor(fps?.source ?? null, ref)} />
      <FpsRow label="Codificado" value={fps?.encoded ?? null} color={fpsColor(fps?.encoded ?? null, ref)} />
      <FpsRow label="Recebido" value={fps?.received ?? null} color={fpsColor(fps?.received ?? null, ref)} />
      <FpsRow label="Decodificado" value={fps?.decoded ?? null} color={fpsColor(fps?.decoded ?? null, ref)} />
      <FpsRow label="Apresentado" value={fps?.presented ?? null} color={fpsColor(fps?.presented ?? null, ref)} />
      <Row label="Resolução" value={resolution.width !== null && resolution.height !== null ? `${resolution.width}×${resolution.height}` : UNAVAILABLE_LABEL} />
      <Row label={sender ? 'Bitrate enviado' : 'Bitrate recebido'} value={formatBitrate(bitrate)} />
      <Row label="Codec" value={sample?.videoCodec ?? UNAVAILABLE_LABEL} />
      <Row label="RTT" value={sample ? formatOptional(sample.network.rttMs, 0, 'ms') : UNAVAILABLE_LABEL} />
      <Row label={sender ? 'Jitter RTCP' : 'Jitter'} value={formatOptional(jitter, 1, 'ms')} />
      <Row label={sender ? 'Perda RTCP' : 'Perda'} value={loss === null ? UNAVAILABLE_LABEL : `${loss.toFixed(1)}%`} />
      <Row label="Conexão" value={sample ? routeLabel(sample.network.route) : UNAVAILABLE_LABEL} />
      <div className="flex items-center justify-between gap-4 pt-1 border-t border-white/5">
        <span>Áudio</span>
        <span className={sample?.hasAudio ? 'text-green-400' : 'text-red-400'}>
          {sample ? (sample.hasAudio ? `${sample.audioCodec ?? 'áudio'} · ${formatBitrate(sample.audioBitrate)}` : 'Sem áudio') : UNAVAILABLE_LABEL}
        </span>
      </div>
      {adaptiveState && <Row label="Bitrate adapt." value={adaptiveState} valueClass="text-cyan-400" />}
      {viewerCount !== null && <Row label="Espectadores" value={String(viewerCount)} />}
    </div>
  );
}

function Technical({
  sample,
  chart,
  events,
  livePlayback,
}: {
  sample: MetricSample | null;
  chart: ChartPoint[];
  events: DiagnosticsSnapshot['recentEvents'];
  livePlayback: PlaybackSample | null;
}) {
  const out = sample?.outbound;
  const inn = sample?.inbound;
  const net = sample?.network;
  const play = sample?.playback ?? livePlayback;
  return (
    <div className="flex flex-col gap-2">
      <Layer title="Captura / codificação">
        <Row label="FPS origem" value={formatMeasuredFps(out?.sourceFps ?? null, 1)} />
        <Row label="FPS codificado" value={formatMeasuredFps(out?.encodedFps ?? null, 1)} />
        <Row label="FPS reportado" value={formatMeasuredFps(out?.reportedFps ?? null, 1)} />
        <Row label="Variação" value={formatOptional(out?.frameProductionVariation ?? null, 1, 'fps')} />
        <Row label="Origem − codificado" value={formatOptional(out?.sourceToEncodedGap ?? null, 1, 'fps')} />
        <Row label="Encode / frame" value={formatOptional(out?.encodeTimePerFrameMs ?? null, 1, 'ms')} />
        <Row label="Limitação" value={out?.qualityLimitationReason ?? UNAVAILABLE_LABEL} />
        <Row label="Bitrate alvo" value={formatBitrate(out?.targetBitrate ?? null)} />
        <Row label="Keyframe/s" value={formatOptional(out?.keyFramesPerSec ?? null, 2, '')} />
        <Row label="NACK/s" value={formatOptional(out?.nackPerSec ?? null, 1, '')} />
        <Row label="PLI/s" value={formatOptional(out?.pliPerSec ?? null, 1, '')} />
        <Row label="FIR/s" value={formatOptional(out?.firPerSec ?? null, 1, '')} />
        <Row label="Origem" value={out?.sourceId ?? UNAVAILABLE_LABEL} />
      </Layer>
      <Layer title="Rede / transporte">
        <Row label="Rota" value={net ? routeLabel(net.route) : UNAVAILABLE_LABEL} />
        <Row label="Candidato local" value={net?.localCandidateType ?? UNAVAILABLE_LABEL} />
        <Row label="Candidato remoto" value={net?.remoteCandidateType ?? UNAVAILABLE_LABEL} />
        <Row label="Protocolo" value={net?.protocol ?? UNAVAILABLE_LABEL} />
        <Row label="Seleção ICE" value={net?.selection ?? UNAVAILABLE_LABEL} />
        <Row label="RTT" value={formatOptional(net?.rttMs ?? null, 0, 'ms')} />
        <Row label="Banda saída" value={formatBitrate(net?.availableOutgoingBitrate ?? null)} />
        <Row label="Banda entrada" value={formatBitrate(net?.availableIncomingBitrate ?? null)} />
        <Row label="Estado" value={sample?.connectionState ?? UNAVAILABLE_LABEL} />
        <Row label="Perda RTCP" value={formatOptional(sample?.remoteInbound?.lossPct ?? null, 1, '%')} />
      </Layer>
      <Layer title="Recepção / decodificação">
        <Row label="FPS recebido" value={formatMeasuredFps(inn?.receivedFps ?? null, 1)} />
        <Row label="FPS decodificado" value={formatMeasuredFps(inn?.decodedFps ?? null, 1)} />
        <Row label="FPS reportado" value={formatMeasuredFps(inn?.reportedFps ?? null, 1)} />
        <Row label="Descartados/s" value={formatOptional(inn?.droppedFps ?? null, 1, '')} />
        <Row label="Decode / frame" value={formatOptional(inn?.decodeTimePerFrameMs ?? null, 1, 'ms')} />
        <Row label="Perda" value={inn?.lossPct == null ? UNAVAILABLE_LABEL : `${inn.lossPct.toFixed(2)}%`} />
        <Row label="Jitter" value={formatOptional(inn?.jitterMs ?? null, 1, 'ms')} />
        <Row label="Jitter buffer" value={formatOptional(inn?.jitterBufferAvgDelayMs ?? null, 1, 'ms')} />
        <Row label="Congelamentos" value={formatOptional(inn?.freezes ?? null, 0, '')} />
        <Row label="Bitrate" value={formatBitrate(inn?.bitrate ?? null)} />
      </Layer>
      <Layer title="Reprodução">
        <Row label="FPS apresentado" value={formatMeasuredFps(play?.presentedFps ?? null, 1)} />
        <Row label="Descartados/s" value={formatOptional(play?.droppedFps ?? null, 1, '')} />
        <Row label="Corrompidos/s" value={formatOptional(play?.corruptedFps ?? null, 1, '')} />
        <Row label="Intervalos irregulares" value={play ? String(play.irregularIntervals) : UNAVAILABLE_LABEL} />
        <Row label="Congelamento" value={play ? (play.freezeSuspected ? 'sim' : 'não') : UNAVAILABLE_LABEL} />
        <Row label="API" value={play?.api ?? UNAVAILABLE_LABEL} />
      </Layer>
      <Layer title="Últimos 60 segundos">
        <Sparkline points={chart} />
      </Layer>
      <Layer title="Eventos recentes">
        {events.length === 0 && <span className="text-white/50">Nenhum evento registrado.</span>}
        {events.map((event, index) => (
          <div key={`${event.timestamp}-${index}`} className="flex flex-col border-t border-white/5 pt-1">
            <span className={event.severity === 'crítico' ? 'text-red-400' : event.severity === 'atenção' ? 'text-yellow-400' : 'text-white/80'}>
              {new Date(event.timestamp).toLocaleTimeString('pt-BR')} · {event.message}
            </span>
            <span className="text-white/45">{event.category}</span>
          </div>
        ))}
      </Layer>
    </div>
  );
}

function Sparkline({ points }: { points: ChartPoint[] }) {
  const series = [
    { key: 'encodedFps' as const, color: '#34d399', label: 'cod' },
    { key: 'receivedFps' as const, color: '#93c5fd', label: 'rec' },
    { key: 'decodedFps' as const, color: '#fbbf24', label: 'dec' },
    { key: 'presentedFps' as const, color: '#f472b6', label: 'apr' },
  ];
  const values = points.flatMap((point) => series.map((item) => point[item.key])).filter((value): value is number => value !== null);
  if (values.length < 2) return <span className="text-white/50">Sem histórico suficiente.</span>;
  const max = Math.max(5, ...values);
  const width = 300;
  const height = 52;
  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-14">
        {series.map((item) => (
          <polyline
            key={item.key}
            fill="none"
            stroke={item.color}
            strokeWidth="1.4"
            points={linePoints(points, item.key, width, height, max)}
          />
        ))}
      </svg>
      <div className="flex gap-2 text-[10px] text-white/60">
        {series.map((item) => (
          <span key={item.key} style={{ color: item.color }}>{item.label}</span>
        ))}
      </div>
    </div>
  );
}

function linePoints(points: ChartPoint[], key: keyof ChartPoint, width: number, height: number, max: number): string {
  const usable = points.map((point, index) => ({ index, value: point[key] })).filter((item): item is { index: number; value: number } => typeof item.value === 'number');
  return usable.map((item) => {
    const x = points.length <= 1 ? 0 : (item.index / (points.length - 1)) * width;
    const y = height - (item.value / max) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function Layer({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <h4 className="text-[10px] uppercase tracking-wider text-primary font-bold pt-1">{title}</h4>
      {children}
    </section>
  );
}

function FpsRow({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <span className={`font-medium ${color}`}>{formatMeasuredFps(value)}</span>
    </div>
  );
}

function Row({ label, value, valueClass = 'text-white' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-white/70">{label}</span>
      <span className={`font-medium text-right ${valueClass}`}>{value}</span>
    </div>
  );
}

function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-1.5 py-0.5 rounded cursor-pointer ${active ? 'text-primary bg-white/10' : 'text-white/50 hover:text-white'}`}
    >
      {children}
    </button>
  );
}

function stateClass(state: DiagnosisState): string {
  if (state === 'NORMAL') return 'text-green-400';
  if (state === 'ATENÇÃO') return 'text-yellow-400';
  if (state === 'CRÍTICO') return 'text-red-400';
  return 'text-white/60';
}
