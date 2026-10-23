import React from 'react';
import { clsx } from 'clsx';

export type Tone = 'ok' | 'caution' | 'risk' | 'neutral';

/** The Hirivo mark: a check that is also the stem of an "h". Colours follow the theme tokens. */
export function Mark({ size = 20 }: { size?: number }) {
  const stroke = { fill: 'none', strokeWidth: 3.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <g transform="translate(4.4 0.3) skewX(-16)">
        <path d="M8.7 13 A5 5 0 0 1 18.7 13 V19.8" stroke="var(--ink)" {...stroke} />
        <path d="M4.6 15.4 L8.7 19.8 L8.7 3.6" stroke="var(--brand)" {...stroke} />
      </g>
    </svg>
  );
}

export function Pill({
  tone = 'neutral',
  children,
  onClick,
  expanded,
  title,
}: {
  tone?: Tone;
  children: React.ReactNode;
  onClick?: () => void;
  expanded?: boolean;
  title?: string;
}) {
  const cls = clsx('pill', tone !== 'neutral' && tone);
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} aria-expanded={expanded} title={title}>
      {children}
    </button>
  ) : (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}

export function Meter({ value, tone = 'ok', label }: { value: number; tone?: Tone; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={clsx('meter', tone !== 'ok' && tone)} role="meter" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="card empty fade-in">
      {icon}
      <div className="h2">{title}</div>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Callout({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return <div className={clsx('callout', tone !== 'neutral' && tone)}>{children}</div>;
}

export function toneForScore(score: number | undefined, { good, ok }: { good: number; ok: number }): Tone {
  if (score === undefined) return 'neutral';
  return score >= good ? 'ok' : score >= ok ? 'caution' : 'risk';
}

export function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = React.useState<string | null>(null);
  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
  };
  return [copied, copy];
}

export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
