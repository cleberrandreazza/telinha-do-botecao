/** Leitura que distingue campo ausente (null) de zero medido. */
export function readNumber(report: { [key: string]: unknown } | null | undefined, key: string): number | null {
  if (!report || !(key in report)) return null;
  const value = report[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

export function readString(report: { [key: string]: unknown } | null | undefined, key: string): string | null {
  if (!report || !(key in report)) return null;
  const value = report[key];
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
}
