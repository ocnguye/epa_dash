'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TraineeListItem, TraineeDetail, CohortProcedureItem, TraineeMatch, ProcedureDrilldown,
  resolveTrainee, filterCohortByPhrase, extractPgyFilter, pickMatchSet,
  buildProcedureDrilldown, topProcedureBreakdown, aggregateCohort, displayName, Trend,
} from '@/lib/epaChatbotEngine';

type MatchSource = 'description' | 'dictation' | 'unscoped';

type ChatMessage =
  | { id: string; role: 'user'; kind: 'text'; text: string }
  | { id: string; role: 'bot'; kind: 'help' | 'error'; text: string }
  | { id: string; role: 'bot'; kind: 'ambiguous-trainee'; candidates: TraineeMatch[]; pendingRemainder: string; pendingPgy: number | null }
  | { id: string; role: 'bot'; kind: 'trainee-overview'; trainee: TraineeListItem; detail: TraineeDetail }
  | { id: string; role: 'bot'; kind: 'procedure-drilldown'; trainee: TraineeListItem; drilldown: ProcedureDrilldown; matchSource: MatchSource; cohortAvg: { avg: number; count: number } | null; pgyUsed: number | null }
  | { id: string; role: 'bot'; kind: 'cohort-only'; phrase: string; cohortAvg: { avg: number; count: number }; pgyUsed: number | null }
  | { id: string; role: 'bot'; kind: 'no-match'; traineeName: string; phrase: string; knownProcedures: { label: string; count: number; avg: number | null }[] };

const uid = () => Math.random().toString(36).slice(2);
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const TREND_LABEL: Record<Trend, { label: string; icon: string; color: string }> = {
  improving: { label: 'Improving', icon: '↗', color: 'text-emerald-600' },
  declining: { label: 'Declining', icon: '↘', color: 'text-rose-600' },
  stable: { label: 'Stable', icon: '→', color: 'text-slate-500' },
  insufficient: { label: 'Not enough data yet', icon: '—', color: 'text-slate-400' },
};

const SUGGESTIONS = ["Moon, G-tube", "Hanzhou Li, Thrombectomy", "PGY 2 Paracentesis"];

export default function Chatbot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const traineeListRef = useRef<TraineeListItem[]>([]);
  // cache key: `${id}` for the unfiltered baseline, `${id}::${phrase}` for a server-filtered query
  const traineeDetailCache = useRef<Map<string, TraineeDetail>>(new Map());
  const cohortCache = useRef<Map<string, CohortProcedureItem[]>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (open && traineeListRef.current.length === 0) {
      loadTraineeList().catch(() => {});
    }
  }, [open]);

  function append(msg: ChatMessage) {
    setMessages(prev => [...prev, msg]);
  }

  async function loadTraineeList(): Promise<TraineeListItem[]> {
    const res = await fetch('/api/attendingepa/trainees', { credentials: 'include' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to load trainees');
    traineeListRef.current = data.trainees;
    return data.trainees;
  }

  // phrase omitted -> unfiltered baseline (full history, used for overview + "known procedures")
  // phrase provided -> server-side filtered by proc_desc/proc_code/ContentText
  async function loadTraineeDetail(id: number, phrase?: string): Promise<TraineeDetail> {
    const trimmed = phrase?.trim();
    const cacheKey = trimmed ? `${id}::${trimmed.toLowerCase()}` : `${id}`;
    const cached = traineeDetailCache.current.get(cacheKey);
    if (cached) return cached;

    const url = trimmed
      ? `/api/attendingepa/trainees/${id}?q=${encodeURIComponent(trimmed)}`
      : `/api/attendingepa/trainees/${id}`;
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to load trainee detail');
    const detail: TraineeDetail = { user: data.user, procedures: data.procedures, stats: data.stats };
    traineeDetailCache.current.set(cacheKey, detail);
    return detail;
  }

  async function loadCohortVocab(pgy: number | null): Promise<CohortProcedureItem[]> {
    const key = pgy == null ? 'all' : String(pgy);
    const cached = cohortCache.current.get(key);
    if (cached) return cached;
    const url = pgy ? `/api/attendingepa/cohortproc?pgy=${pgy}` : '/api/attendingepa/cohortproc';
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to load cohort data');
    cohortCache.current.set(key, data.procedures);
    return data.procedures;
  }

  async function respondForTrainee(trainee: TraineeListItem, remainder: string, explicitPgy: number | null) {
    // baseline (unfiltered) detail — cheap after first load, cached per trainee
    const baseline = await loadTraineeDetail(trainee.user_id);

    if (!remainder.trim()) {
      append({ id: uid(), role: 'bot', kind: 'trainee-overview', trainee, detail: baseline });
      return;
    }

    // server-filtered set: matches proc_desc/proc_code OR ContentText
    const filtered = await loadTraineeDetail(trainee.user_id, remainder);

    if (filtered.procedures.length === 0) {
      append({
        id: uid(), role: 'bot', kind: 'no-match',
        traineeName: displayName(trainee), phrase: remainder,
        knownProcedures: topProcedureBreakdown(baseline.procedures, 5),
      });
      return;
    }

    // prefer rows that matched on the formal procedure fields; only fall back to
    // ContentText-only matches if NO description-based match exists
    const { matched, source } = pickMatchSet(filtered.procedures);

    const drilldown = buildProcedureDrilldown(matched, remainder);
    const cohort = await loadCohortVocab(explicitPgy ?? trainee.pgy ?? null);
    const cohortAvg = aggregateCohort(filterCohortByPhrase(cohort, remainder));

    append({
      id: uid(), role: 'bot', kind: 'procedure-drilldown',
      trainee, drilldown, matchSource: source, cohortAvg, pgyUsed: explicitPgy ?? trainee.pgy,
    });
  }

  async function respondForCohortOnly(remainder: string, explicitPgy: number | null) {
    const cohort = await loadCohortVocab(explicitPgy);
    const matches = filterCohortByPhrase(cohort, remainder);
    const cohortAvg = aggregateCohort(matches);
    if (!cohortAvg) {
      append({ id: uid(), role: 'bot', kind: 'help', text: `I couldn't find a trainee or procedure matching "${remainder}". Try a last name plus a procedure, e.g. "Smith G-tube".` });
      return;
    }
    append({ id: uid(), role: 'bot', kind: 'cohort-only', phrase: remainder, cohortAvg, pgyUsed: explicitPgy });
  }

  async function handleSend(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || loading) return;
    append({ id: uid(), role: 'user', kind: 'text', text: trimmed });
    setInput('');
    setLoading(true);
    try {
      const trainees = traineeListRef.current.length ? traineeListRef.current : await loadTraineeList();
      const { pgy: explicitPgy, remainder: afterPgy } = extractPgyFilter(trimmed);
      const { trainee, remainder, ambiguous } = resolveTrainee(afterPgy, trainees);

      if (ambiguous.length > 0) {
        append({ id: uid(), role: 'bot', kind: 'ambiguous-trainee', candidates: ambiguous, pendingRemainder: remainder || afterPgy, pendingPgy: explicitPgy });
        return;
      }
      if (trainee) {
        await respondForTrainee(trainee, remainder, explicitPgy);
      } else if (afterPgy.trim()) {
        await respondForCohortOnly(afterPgy, explicitPgy);
      } else {
        append({ id: uid(), role: 'bot', kind: 'help', text: `I couldn't find a trainee matching "${trimmed}". Try a last name, e.g. "Smith G-tube".` });
      }
    } catch (e: any) {
      append({ id: uid(), role: 'bot', kind: 'error', text: e?.message || 'Something went wrong fetching that data.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleAmbiguousPick(candidate: TraineeMatch, pendingRemainder: string, pendingPgy: number | null) {
    setLoading(true);
    try {
      await respondForTrainee(candidate.trainee, pendingRemainder, pendingPgy);
    } catch (e: any) {
      append({ id: uid(), role: 'bot', kind: 'error', text: e?.message || 'Something went wrong fetching that data.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {open ? (
        <div className="flex h-[520px] w-[360px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
            <span className="text-sm font-semibold text-slate-700">EPA Chatbot</span>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-slate-500">Ask about a trainee and a procedure, e.g. "Smith G-tube".</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => handleSend(s)} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(m => <MessageBubble key={m.id} msg={m} onPickAmbiguous={handleAmbiguousPick} />)}

            {loading && (
              <div className="flex items-center gap-1 px-1 text-slate-400">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
              </div>
            )}
          </div>

          <form
            onSubmit={e => { e.preventDefault(); handleSend(input); }}
            className="flex items-center gap-2 border-t border-slate-100 p-2"
          >
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
              placeholder="Trainee, procedure…"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 outline-none focus:border-slate-400"
              disabled={loading}
            />
            <button type="submit" disabled={loading || !input.trim()} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-40">
              Send
            </button>
          </form>
        </div>
      ) : (
        <div className="relative inline-flex group">
            <div
                className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2
                            w-56 rounded bg-slate-600 px-2 py-1 text-xs text-white
                            opacity-0 transition-opacity duration-75
                            group-hover:opacity-100 group-focus:opacity-100"
                >
                Ask about a trainee’s performance on a procedure.
            </div>

            <button
                onClick={() => setOpen(true)}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ffc48c] text-white shadow-lg hover:bg-[#ffc48c]/80"
                aria-label="Open EPA lookup"
            >
                <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-6 w-6"
                >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M18.81,16.23,20,21l-4.95-2.48A9.84,9.84,0,0,1,12,19c-5,0-9-3.58-9-8s4-8,9-8,9,3.58,9,8A7.49,7.49,0,0,1,18.81,16.23Z"
                />
                </svg>
            </button>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg, onPickAmbiguous }: { msg: ChatMessage; onPickAmbiguous: (c: TraineeMatch, remainder: string, pgy: number | null) => void }) {
  if (msg.role === 'user') {
    return <div className="ml-auto max-w-[85%] rounded-2xl bg-slate-600 px-3 py-2 text-sm text-white">{msg.text}</div>;
  }

  switch (msg.kind) {
    case 'help':
    case 'error':
      return <div className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${msg.kind === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{msg.text}</div>;

    case 'ambiguous-trainee':
      return (
        <div className="max-w-[90%] space-y-2 rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-600">
          <p>Did you mean:</p>
          <div className="flex flex-wrap gap-2">
            {msg.candidates.map(c => (
              <button
                key={c.trainee.user_id}
                onClick={() => onPickAmbiguous(c, msg.pendingRemainder, msg.pendingPgy)}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50"
              >
                {displayName(c.trainee)} {c.trainee.pgy ? `(PGY-${c.trainee.pgy})` : ''}
              </button>
            ))}
          </div>
        </div>
      );

    case 'trainee-overview': {
      const { trainee, detail } = msg;
      const top = topProcedureBreakdown(detail.procedures, 5);
      return (
        <Card>
          <CardTitle>{displayName(trainee)}{trainee.pgy ? ` · PGY-${trainee.pgy}` : ''}</CardTitle>
          <Stat label="Average EPA" value={detail.stats.avg_epa || '—'} />
          <Stat label="Total reports" value={detail.stats.total_reports} />
          <Stat label="Cases this month" value={detail.stats.procedures} />
          {(detail.stats.feedback_requested > 0 || detail.stats.feedback_discussed > 0) && (
            <Stat label="Feedback pending / discussed" value={`${detail.stats.feedback_requested} / ${detail.stats.feedback_discussed}`} />
          )}
          {top.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-xs font-medium text-slate-500">Top procedures</p>
              {top.map(p => (
                <div key={p.label} className="flex justify-between text-xs text-slate-600">
                  <span className="truncate pr-2">{p.label}</span>
                  <span className="whitespace-nowrap text-slate-400">{p.count}× {p.avg != null ? `· avg ${p.avg}` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      );
    }

    case 'procedure-drilldown': {
      const { trainee, drilldown, matchSource, cohortAvg, pgyUsed } = msg;
      const trend = TREND_LABEL[drilldown.trend];
      return (
        <Card>
          <CardTitle>{displayName(trainee)} · {drilldown.procedureLabel}</CardTitle>
          {matchSource === 'dictation' && (
            <p className="text-xs italic text-amber-600">
              No procedure description/code matched directly — based on mentions found in report text.
            </p>
          )}
          <Stat label="Last Performed:" value={drilldown.lastDate ? fmtDate(drilldown.lastDate) : '—'} />
          <Stat label="Average EPA:" value={drilldown.averageEpa ?? '—'} sub={`${drilldown.scoredCount} scored of ${drilldown.totalCount} cases`} />
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Trend (last {drilldown.last5.length}): </span>
            <span className={`font-medium ${trend.color}`}>{trend.icon} {trend.label}</span>
          </div>
          {drilldown.last5.length > 0 && (
            <p className="text-xs text-slate-400">Scores: {drilldown.last5.map(s => s.score).join(' → ')}</p>
          )}
          {cohortAvg && (
            <p className="mt-1 text-xs text-slate-400">
              {pgyUsed ? `PGY-${pgyUsed} Cohort Avg` : 'Cohort Avg'}: {cohortAvg.avg} ({cohortAvg.count} cases)
            </p>
          )}
        </Card>
      );
    }

    case 'cohort-only':
      return (
        <Card>
          <CardTitle>{msg.pgyUsed ? `PGY-${msg.pgyUsed} · ` : ''}{msg.phrase}</CardTitle>
          <Stat label="Cohort average EPA" value={msg.cohortAvg.avg} sub={`${msg.cohortAvg.count} cases`} />
        </Card>
      );

    case 'no-match':
      return (
        <Card>
          <CardTitle>No "{msg.phrase}" cases for {msg.traineeName}</CardTitle>
          {msg.knownProcedures.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-slate-500">On file for this trainee:</p>
              {msg.knownProcedures.map(p => (
                <div key={p.label} className="flex justify-between text-xs text-slate-600">
                  <span className="truncate pr-2">{p.label}</span>
                  <span className="text-slate-400">{p.count}×</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      );
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="max-w-[90%] space-y-1.5 rounded-2xl border border-slate-100 bg-white px-3 py-3 text-sm shadow-sm">{children}</div>;
}
function CardTitle({ children }: { children: React.ReactNode }) {
  return <p className="font-semibold text-slate-700">{children}</p>;
}
function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-700">{value}{sub && <span className="ml-1 text-xs text-slate-400">{sub}</span>}</span>
    </div>
  );
}