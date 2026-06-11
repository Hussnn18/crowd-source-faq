/**
 * GoldenTicketPage — v1.65.1, user-driven Golden Ticket flow.
 *
 * v1.65 layout: two-column grid (form left, Escalation Queue right).
 * v1.65.1 redesign to match the user's reference design:
 *   • Form column shows the slider + query + context + Submit
 *     Escalation. The "Cooldown Active" state REPLACES the form
 *     entirely (matches screenshot 3: a centered lock icon,
 *     "Cooldown Active" headline, subtext, and a giant MM:HH:SS
 *     countdown). The Escalation Queue stays visible on the
 *     right so the user can see the in-flight escalations.
 *   • Penalty/ban removed per the new spec. SP is consumed on
 *     submission regardless of admin outcome; the cooldown is
 *     the only post-submission consequence.
 *   • Back button at the top.
 *
 * Server enforces all the math. The page is read-only on its own
 * data and refetches on submit, on userId change, and on focus.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  fetchGoldenQueue,
  fetchSpurtiStatus,
  submitGoldenTicket,
  type GoldenQueueItem,
  type SpurtiStatus,
} from '../components/support/api';

const MIN_SP = 1;
const MAX_SP = 100;

function friendlyError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } } };
  return e?.response?.data?.message || fallback;
}

/** Format ms-remaining as compact "Xd Yh / Yh Mm / Mm" string. */
function formatRemaining(ms: number): string {
  if (ms <= 0) return 'now';
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Format ms-remaining as the giant MM:HH:SS countdown (screenshot 3). */
function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function GoldenTicketPage(): React.ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAuthed = Boolean(user?.id);

  const [status, setStatus] = useState<SpurtiStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const [spCost, setSpCost] = useState<number>(1);
  const [title, setTitle] = useState<string>('');
  const [details, setDetails] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [queue, setQueue] = useState<GoldenQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);

  // Live "now" for countdown text. Refetched every 30s so the
  // countdown text doesn't go stale between user interactions.
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const remainingSp = useMemo(() => {
    const total = status?.sp ?? 0;
    return Math.max(0, total - spCost);
  }, [status?.sp, spCost]);

  useEffect(() => {
    if (!status) return;
    const cap = Math.min(MAX_SP, status.sp);
    if (spCost > cap) setSpCost(Math.max(MIN_SP, Math.min(cap, 1)));
  }, [status?.sp, status?.canSubmitGolden]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadStatus = useCallback(async () => {
    if (!isAuthed) return;
    setStatusLoading(true);
    try {
      const s = await fetchSpurtiStatus();
      setStatus(s);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, [isAuthed]);

  const reloadQueue = useCallback(async () => {
    if (!isAuthed) return;
    setQueueLoading(true);
    try {
      const items = await fetchGoldenQueue(8);
      setQueue(items);
    } catch {
      setQueue([]);
    } finally {
      setQueueLoading(false);
    }
  }, [isAuthed]);

  useEffect(() => { void reloadStatus(); }, [reloadStatus]);
  useEffect(() => { void reloadQueue(); }, [reloadQueue]);

  const inCooldown = status ? !status.canSubmitGolden : false;
  const cooldownEndsAt = status?.cooldownEndsAt ?? null;
  const cooldownMsLeft = cooldownEndsAt ? Math.max(0, new Date(cooldownEndsAt).getTime() - now) : 0;

  const canSubmit =
    isAuthed &&
    !inCooldown &&
    spCost > 0 &&
    spCost <= (status?.sp ?? 0) &&
    title.trim().length > 0 &&
    details.trim().length > 0 &&
    !submitting;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitGoldenTicket(title.trim(), details.trim(), spCost);
      setTitle('');
      setDetails('');
      setSpCost(1);
      await Promise.all([reloadStatus(), reloadQueue()]);
    } catch (err) {
      setSubmitError(friendlyError(err, 'Failed to submit Golden ticket.'));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Unauthed gate ────────────────────────────────────────────────────────
  if (!isAuthed) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="font-serif text-3xl text-ink mb-3">Golden Ticket</h1>
        <p className="text-ink-soft">Sign in to escalate a time-sensitive query with Spurti Points.</p>
        <Link
          to="/"
          className="inline-block mt-6 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* v1.66 anti-pattern: never use navigate(-1) for back. */}
      <button
        type="button"
        onClick={() => navigate('/home')}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink transition-colors"
        aria-label="Back to home"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>

      {/* Header — always visible so the user has context. */}
      <header className="mb-8 flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-card border border-border flex items-center justify-center text-accent shrink-0">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3 7l5 4 4-6 4 6 5-4-1 11H4L3 7zm0 14h18v2H3v-2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-serif text-3xl tracking-tight text-ink">Golden Ticket</h1>
          <p className="text-sm text-ink-soft mt-1">
            Escalate a time-sensitive query to the admin team. Higher SP = higher priority
            in the queue. Admins resolve directly — no penalties, no bans, just a 48h
            cooldown between submissions.
          </p>
        </div>
        {status && (
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-sm font-semibold shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2 c 0 6 -6 6 -6 12 a 6 6 0 0 0 12 0 c 0 -3 -2 -5 -3 -7 c -1 2 -3 3 -3 -5 z" />
            </svg>
            <span className="tabular-nums">{status.sp}</span>
            <span className="text-accent/70 font-medium">SP</span>
          </div>
        )}
      </header>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
        {/* ── Left column: form OR cooldown state ────────────────── */}
        {inCooldown && cooldownEndsAt ? (
          /* v1.65.1 — fullscreen-centered "Cooldown Active" state.
             Matches the user's reference design (screenshot 3): a
             centered lock icon, "Cooldown Active" headline, subtext,
             and a giant MM:HH:SS countdown. The form is fully
             hidden in this state — no point letting the user type
             into a form they can't submit. */
          <div
            role="status"
            aria-live="polite"
            className="bg-card border border-border rounded-2xl px-6 py-16 shadow-sm flex flex-col items-center justify-center text-center min-h-[420px]"
          >
            <div className="w-16 h-16 rounded-full bg-amber-100 border-2 border-amber-300 flex items-center justify-center text-amber-700 mb-4">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </div>
            <h2 className="font-serif text-2xl text-ink mb-1">Cooldown Active</h2>
            <p className="text-sm text-ink-soft mb-6 max-w-md">
              You may raise another Golden Ticket after the cooldown expires.
            </p>
            <div
              className="font-mono text-5xl tabular-nums text-accent font-semibold tracking-wider"
              aria-label={`Time remaining: ${formatRemaining(cooldownMsLeft)}`}
            >
              {formatCountdown(cooldownMsLeft)}
            </div>
            <p className="text-xs text-ink-faint mt-3 tabular-nums">
              {cooldownMsLeft > 0 ? formatRemaining(cooldownMsLeft) : 'unlocking…'}
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-5"
          >
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className="text-sm font-semibold text-ink">Spurti Point Investment</label>
                <span className="text-xs text-ink-soft">Higher SP = higher priority</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden="true">🔥</span>
                <input
                  type="range"
                  min={MIN_SP}
                  max={Math.max(MIN_SP, Math.min(MAX_SP, status?.sp ?? 0))}
                  value={spCost}
                  onChange={(e) => setSpCost(Math.max(MIN_SP, Number(e.target.value)))}
                  disabled={!status || status.sp < MIN_SP}
                  className="flex-1 accent-accent disabled:opacity-50"
                  aria-label="Spurti Points to invest"
                />
                <span className="font-semibold text-ink tabular-nums w-16 text-right">
                  {spCost} <span className="text-ink-soft font-normal">SP</span>
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-ink-soft mt-1 tabular-nums">
                <span>{MIN_SP}</span>
                <span>Remaining: {remainingSp} SP</span>
                <span>{MAX_SP}</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-ink mb-1">
                Urgent Query <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Short, direct summary of your problem"
                maxLength={120}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-ink placeholder:text-ink-soft focus:outline-none focus:border-accent/60"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-ink mb-1">
                Full Context <span className="text-red-500">*</span>
              </label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="What happened, what you've tried, what you need from the support team."
                maxLength={2000}
                rows={6}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-ink placeholder:text-ink-soft focus:outline-none focus:border-accent/60 resize-y"
              />
              <p className="text-[11px] text-ink-soft mt-1 text-right">
                {details.length} / 2000
              </p>
            </div>

            {submitError && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
                {submitError}
              </div>
            )}

            <div className="flex items-center justify-end pt-2">
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
              >
                {submitting ? 'Submitting…' : 'Submit Escalation'}
              </button>
            </div>
          </form>
        )}

        {/* ── Right column: Escalation Queue (always visible) ──── */}
        <aside className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-ink mb-4">Escalation Queue</h2>

          {queueLoading && queue.length === 0 ? (
            <p className="text-sm text-ink-soft">Loading…</p>
          ) : queue.length === 0 ? (
            <p className="text-sm text-ink-soft">
              No escalations yet. Be the first to file a Golden Ticket.
            </p>
          ) : (
            <ul className="space-y-3">
              {queue.map((item) => (
                <li
                  key={item._id}
                  className="rounded-xl border border-border/60 bg-bg/50 p-3"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                      {item.userName}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-accent">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 2 c 0 6 -6 6 -6 12 a 6 6 0 0 0 12 0 c 0 -3 -2 -5 -3 -7 c -1 2 -3 3 -3 -5 z" />
                      </svg>
                      {item.spCost} SP
                    </span>
                  </div>
                  <p className="text-sm text-ink line-clamp-1">{item.title}</p>
                  {item.details && (
                    <p className="text-xs text-ink-soft mt-1 line-clamp-2 italic">"{item.details}"</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {statusLoading && !status && (
        <p className="text-center text-sm text-ink-soft mt-6">Loading your Spurti Points balance…</p>
      )}
    </div>
  );
}
