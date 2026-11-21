/**
 * Fotografia da resolução pedida, da track e do encoder.
 * Campo ausente fica null. Nada aqui é preenchido com o valor de outra etapa.
 */

export interface RequestedCapture {
  label: string | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
}

export interface TrackSettingsView {
  width: number | null;
  height: number | null;
  frameRate: number | null;
  displaySurface: string | null;
  aspectRatio: number | null;
  resizeMode: string | null;
}

export interface NumericConstraint {
  exact: number | null;
  ideal: number | null;
  min: number | null;
  max: number | null;
}

export interface StringConstraint {
  exact: string | null;
  ideal: string | null;
}

export interface CaptureConstraintsView {
  width: NumericConstraint | null;
  height: NumericConstraint | null;
  frameRate: NumericConstraint | null;
  aspectRatio: NumericConstraint | null;
  resizeMode: StringConstraint | null;
  displaySurface: StringConstraint | null;
}

export interface NumericRange {
  min: number | null;
  max: number | null;
}

export interface CaptureCapabilitiesView {
  width: NumericRange | null;
  height: NumericRange | null;
  frameRate: NumericRange | null;
  aspectRatio: NumericRange | null;
  resizeMode: string[] | null;
}

export interface CaptureProbe {
  requested: RequestedCapture;
  settings: TrackSettingsView;
  constraints: CaptureConstraintsView | null;
  capabilities: CaptureCapabilitiesView | null;
  readyState: string | null;
  contentHint: string | null;
}

export interface EncoderEncoding {
  maxBitrate: number | null;
  maxFramerate: number | null;
  scaleResolutionDownBy: number | null;
  degradationPreference: string | null;
}

export interface EncoderProbe {
  connectionId: string;
  before: EncoderEncoding;
  after: EncoderEncoding | null;
}

export interface ResolutionFacts {
  requested: { label: string | null; width: number | null; height: number | null; frameRate: number | null };
  capturedTrack: { width: number | null; height: number | null; frameRate: number | null };
  webrtcSource: { width: number | null; height: number | null };
  encoded: { width: number | null; height: number | null };
  received: { width: number | null; height: number | null };
}

export interface CaptureTrackLike {
  readyState?: string;
  contentHint?: string;
  getSettings?: () => object;
  getConstraints?: () => object;
  getCapabilities?: () => object;
}

export interface EncoderParamsLike {
  degradationPreference?: unknown;
  encodings?: Array<{
    maxBitrate?: unknown;
    maxFramerate?: unknown;
    scaleResolutionDownBy?: unknown;
  } | null | undefined> | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numericConstraint(value: unknown): NumericConstraint | null {
  if (typeof value === 'number') {
    return { exact: finiteNumber(value), ideal: null, min: null, max: null };
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const view = {
    exact: finiteNumber(record.exact),
    ideal: finiteNumber(record.ideal),
    min: finiteNumber(record.min),
    max: finiteNumber(record.max),
  };
  if (view.exact === null && view.ideal === null && view.min === null && view.max === null) return null;
  return view;
}

function stringConstraint(value: unknown): StringConstraint | null {
  if (typeof value === 'string') return { exact: text(value), ideal: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const view = { exact: text(record.exact), ideal: text(record.ideal) };
  if (view.exact === null && view.ideal === null) return null;
  return view;
}

function rangeOf(value: unknown): NumericRange | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const min = finiteNumber(record.min);
  const max = finiteNumber(record.max);
  if (min === null && max === null) return null;
  return { min, max };
}

export function emptyTrackSettings(): TrackSettingsView {
  return {
    width: null,
    height: null,
    frameRate: null,
    displaySurface: null,
    aspectRatio: null,
    resizeMode: null,
  };
}

export function emptyEncoderEncoding(): EncoderEncoding {
  return {
    maxBitrate: null,
    maxFramerate: null,
    scaleResolutionDownBy: null,
    degradationPreference: null,
  };
}

export function readTrackSettings(settings: Record<string, unknown> | null | undefined): TrackSettingsView {
  if (!settings) return emptyTrackSettings();
  return {
    width: finiteNumber(settings.width),
    height: finiteNumber(settings.height),
    frameRate: finiteNumber(settings.frameRate),
    displaySurface: text(settings.displaySurface),
    aspectRatio: finiteNumber(settings.aspectRatio),
    resizeMode: text(settings.resizeMode),
  };
}

export function readCaptureConstraints(constraints: Record<string, unknown> | null | undefined): CaptureConstraintsView | null {
  if (!constraints) return null;
  return {
    width: numericConstraint(constraints.width),
    height: numericConstraint(constraints.height),
    frameRate: numericConstraint(constraints.frameRate),
    aspectRatio: numericConstraint(constraints.aspectRatio),
    resizeMode: stringConstraint(constraints.resizeMode),
    displaySurface: stringConstraint(constraints.displaySurface),
  };
}

export function readCaptureCapabilities(capabilities: Record<string, unknown> | null | undefined): CaptureCapabilitiesView | null {
  if (!capabilities) return null;
  const resizeMode = Array.isArray(capabilities.resizeMode)
    ? capabilities.resizeMode.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : null;
  return {
    width: rangeOf(capabilities.width),
    height: rangeOf(capabilities.height),
    frameRate: rangeOf(capabilities.frameRate),
    aspectRatio: rangeOf(capabilities.aspectRatio),
    resizeMode,
  };
}

export function readCaptureProbe(requested: RequestedCapture, track: CaptureTrackLike | null | undefined): CaptureProbe {
  let settings = emptyTrackSettings();
  if (typeof track?.getSettings === 'function') {
    try {
      settings = readTrackSettings(track.getSettings() as Record<string, unknown>);
    } catch {
      settings = emptyTrackSettings();
    }
  }
  let constraints: CaptureConstraintsView | null = null;
  if (typeof track?.getConstraints === 'function') {
    try {
      constraints = readCaptureConstraints(track.getConstraints() as Record<string, unknown>);
    } catch {
      constraints = null;
    }
  }
  let capabilities: CaptureCapabilitiesView | null = null;
  if (typeof track?.getCapabilities === 'function') {
    try {
      capabilities = readCaptureCapabilities(track.getCapabilities() as Record<string, unknown>);
    } catch {
      capabilities = null;
    }
  }
  return {
    requested,
    settings,
    constraints,
    capabilities,
    readyState: text(track?.readyState),
    contentHint: text(track?.contentHint),
  };
}

export function readEncoderEncoding(params: EncoderParamsLike | null | undefined): EncoderEncoding {
  if (!params) return emptyEncoderEncoding();
  const encoding = params.encodings?.[0] ?? null;
  return {
    maxBitrate: finiteNumber(encoding?.maxBitrate),
    maxFramerate: finiteNumber(encoding?.maxFramerate),
    scaleResolutionDownBy: finiteNumber(encoding?.scaleResolutionDownBy),
    degradationPreference: text(params.degradationPreference),
  };
}

export function resolutionFacts(
  capture: CaptureProbe | null,
  sample: { role?: string; outbound?: { sourceWidth: number | null; sourceHeight: number | null; frameWidth: number | null; frameHeight: number | null } | null; inbound?: { frameWidth: number | null; frameHeight: number | null } | null } | null,
): ResolutionFacts {
  const sender = sample?.role === 'sender' ? sample.outbound ?? null : null;
  const receiver = sample?.role === 'receiver' ? sample.inbound ?? null : null;
  return {
    requested: {
      label: capture?.requested.label ?? null,
      width: capture?.requested.width ?? null,
      height: capture?.requested.height ?? null,
      frameRate: capture?.requested.frameRate ?? null,
    },
    capturedTrack: {
      width: capture?.settings.width ?? null,
      height: capture?.settings.height ?? null,
      frameRate: capture?.settings.frameRate ?? null,
    },
    webrtcSource: {
      width: sender?.sourceWidth ?? null,
      height: sender?.sourceHeight ?? null,
    },
    encoded: {
      width: sender?.frameWidth ?? null,
      height: sender?.frameHeight ?? null,
    },
    received: {
      width: receiver?.frameWidth ?? null,
      height: receiver?.frameHeight ?? null,
    },
  };
}
