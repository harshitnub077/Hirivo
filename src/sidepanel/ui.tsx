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
      <i style={{ transform: `scaleX(${pct / 100})` }} />
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

/** A segmented control (or underline tabs) with one indicator that slides to the chosen option. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  variant,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  variant?: 'tabs';
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [ready, setReady] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>('button[aria-pressed="true"]');
      if (!on) return;
      el.style.setProperty('--x', `${on.offsetLeft}px`);
      el.style.setProperty('--w', `${on.offsetWidth}px`);
    };
    place();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : undefined;
    ro?.observe(el);
    // The first placement doesn't animate; every change after it slides.
    const id = requestAnimationFrame(() => setReady(true));
    return () => {
      ro?.disconnect();
      cancelAnimationFrame(id);
    };
  }, [value, options.length]);
  return (
    <div ref={ref} className={clsx('seg', variant, ready && 'ready')} role="group" aria-label={label}>
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

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A number that counts up to its value once, so a fresh result reads as just measured. */
export function CountUp({ value, suffix = '', duration = 650 }: { value: number; suffix?: string; duration?: number }) {
  // A hidden or motion-reduced panel shows the real number at once: a count that never runs must
  // never leave a wrong value (0%) on screen.
  const still = () => reducedMotion() || (typeof document !== 'undefined' && document.hidden);
  const [shown, setShown] = React.useState(() => (still() ? value : 0));
  React.useEffect(() => {
    if (still()) return setShown(value);
    // If frames stop (panel hidden mid-count), land on the value anyway.
    const settle = setTimeout(() => setShown(value), duration + 150);
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 4);
      setShown(Math.round(from + (value - from) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [value, duration]);
  return (
    <span className="num" aria-label={`${value}${suffix}`}>
      {shown}
      {suffix}
    </span>
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

/** Per-job scratch state that survives switching tabs (the Now view unmounts on a non-job tab)
 * but not closing the panel. Session storage, so nothing about a draft lingers on disk. */
export function loadSession<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(`hirivo:${key}`);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function saveSession(key: string, value: unknown) {
  try {
    sessionStorage.setItem(`hirivo:${key}`, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the draft just won't survive a tab switch */
  }
}
