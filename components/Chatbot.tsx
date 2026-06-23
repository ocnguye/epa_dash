// chatbot.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import {
  TraineeListItem, TraineeDetail, CohortProcedureItem, TraineeMatch, ProcedureDrilldown,
  ProcedureGroupSummary, resolveTrainee, filterCohortByPhrase, extractPgyFilter, pickMatchSet,
  buildProcedureDrilldown, topProcedureBreakdown, topCohortProcedureBreakdown, aggregateCohort,
  displayName, Trend, summarizeProcedureGroups, summarizeCohortGroups, isDisambiguationResponse,
  ProcedureTypeCandidate, normalize, recordMatchesPhrase,
} from '@/lib/epaChatbotEngine';

type MatchSource = 'description' | 'dictation' | 'unscoped';

// ─── Relevant procedure suggestions ──────────────────────────────────────────
//
// When a search phrase finds nothing for a trainee, surface procedures from
// their history that are *related* to what was typed rather than just their
// most frequent ones. Three passes, progressively looser:
//
//   Pass 1 — recordMatchesPhrase: same logic used for cohort filtering.
//             "paracentesis" matches "US GUIDED PARACENTESIS" etc.
//   Pass 2 — shared meaningful token: "para" shares no full token with
//             "PARACENTESIS" but "drain" shares a token with "DRAIN PLACEMENT".
//   Pass 3 — prefix on any token: "neph" is a prefix of "NEPHROSTOMY".
//   Fallback — top by frequency if nothing related found.
//
// The UI shows a different header depending on whether the results are
// related ("You might be looking for:") or unrelated ("On file for this
// trainee — tap to view:").

const MIN_TOKEN_LEN = 3;

function engTokenize(s: string): string[] {
  return normalize(s).split(' ').filter(t => t.length >= MIN_TOKEN_LEN);
}

function sharesToken(label: string, phrase: string): boolean {
  const labelToks = new Set(engTokenize(label));
  return engTokenize(phrase).some(t => labelToks.has(t));
}

function prefixOverlap(label: string, phrase: string): boolean {
  const lt = engTokenize(label);
  const pt = engTokenize(phrase);
  return lt.some(l => pt.some(p => l.startsWith(p) || p.startsWith(l)));
}

interface SuggestionResult {
  items: { label: string; count: number; avg: number | null }[];
  related: boolean; // true = suggestions are semantically related to the phrase
}

function relevantProcedureSuggestions(
  phrase: string,
  baseline: TraineeDetail,
  topN = 5,
): SuggestionResult {
  const all = topProcedureBreakdown(baseline.procedures, 999);

  const pass1 = all.filter(p => recordMatchesPhrase(p.label, phrase));
  if (pass1.length > 0) return { items: pass1.slice(0, topN), related: true };

  const pass2 = all.filter(p => sharesToken(p.label, phrase));
  if (pass2.length > 0) return { items: pass2.slice(0, topN), related: true };

  const pass3 = all.filter(p => prefixOverlap(p.label, phrase));
  if (pass3.length > 0) return { items: pass3.slice(0, topN), related: true };

  return { items: topProcedureBreakdown(baseline.procedures, topN), related: false };
}

// ─── Message types ────────────────────────────────────────────────────────────

type ChatMessage =
  | { id: string; role: 'user'; kind: 'text'; text: string }
  | { id: string; role: 'bot'; kind: 'help' | 'error'; text: string }
  | { id: string; role: 'bot'; kind: 'ambiguous-trainee'; candidates: TraineeMatch[]; pendingRemainder: string; pendingPgy: number | null }
  | {
      id: string; role: 'bot'; kind: 'ambiguous-procedure';
      candidates: ProcedureTypeCandidate[];
      matchedAlias: string | null;
      originalQuery: string;
      trainee: TraineeListItem | null;
      pendingPgy: number | null;
    }
  | { id: string; role: 'bot'; kind: 'trainee-overview'; trainee: TraineeListItem; detail: TraineeDetail }
  | { id: string; role: 'bot'; kind: 'procedure-drilldown'; trainee: TraineeListItem; drilldown: ProcedureDrilldown; matchSource: MatchSource; cohortAvg: { avg: number | null; count: number; totalCount: number } | null; pgyUsed: number | null; groupSummary: ProcedureGroupSummary }
  | { id: string; role: 'bot'; kind: 'cohort-only'; groupSummary: ProcedureGroupSummary; cohortAvg: { avg: number | null; count: number; totalCount: number }; pgyUsed: number | null }
  | { id: string; role: 'bot'; kind: 'no-match'; trainee: TraineeListItem; traineeName: string; phrase: string; pgyUsed: number | null; suggestions: SuggestionResult }
  | { id: string; role: 'bot'; kind: 'cohort-no-match'; phrase: string; pgyUsed: number | null; knownProcedures: { label: string; count: number; avg: number | null }[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2);
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const TREND_LABEL: Record<Trend, { label: string; icon: string; color: string }> = {
  improving: { label: 'Improving', icon: '↗', color: 'text-emerald-600' },
  declining: { label: 'Declining', icon: '↘', color: 'text-rose-600' },
  stable: { label: 'Stable', icon: '→', color: 'text-slate-500' },
  insufficient: { label: 'Not enough data yet', icon: '—', color: 'text-slate-400' },
};

const SUGGESTIONS = ['Moon, G-tube', 'Hanzhou Li, Thrombectomy', 'PGY 2 Paracentesis'];

function noMatchMessage(
  trainee: TraineeListItem,
  baseline: TraineeDetail,
  remainder: string,
  pgyUsed: number | null,
): ChatMessage {
  return {
    id: uid(), role: 'bot', kind: 'no-match',
    trainee, traineeName: displayName(trainee), phrase: remainder, pgyUsed,
    suggestions: relevantProcedureSuggestions(remainder, baseline),
  };
}

function cohortNoMatchMessage(phrase: string, pgyUsed: number | null, cohort: CohortProcedureItem[]): ChatMessage {
  return {
    id: uid(), role: 'bot', kind: 'cohort-no-match',
    phrase, pgyUsed,
    knownProcedures: topCohortProcedureBreakdown(cohort, 5),
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Chatbot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const traineeListRef = useRef<TraineeListItem[]>([]);
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

  // ─── Data fetching ──────────────────────────────────────────────────────────

  async function loadTraineeList(): Promise<TraineeListItem[]> {
    const res = await fetch('/api/attendingepa/trainees', { credentials: 'include' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to load trainees');
    traineeListRef.current = data.trainees;
    return data.trainees;
  }

  async function fetchTraineeDetail(
    id: number,
    opts: { phrase?: string; procTypeIds?: number[]; exactDesc?: string } = {},
  ): Promise<{ raw: any; detail?: TraineeDetail }> {
    const { phrase, procTypeIds, exactDesc } = opts;
    const trimmed = phrase?.trim();

    let cacheKey: string;
    let url: string;

    if (procTypeIds && procTypeIds.length > 0) {
      const idsStr = procTypeIds.sort().join(',');
      cacheKey = `${id}::ids:${idsStr}`;
      url = `/api/attendingepa/trainees/${id}?proc_type_ids=${encodeURIComponent(idsStr)}`;
    } else if (exactDesc?.trim()) {
      // Exact ProcedureDescList match — bypasses alias resolution entirely.
      // Used when the attending clicks a known procedure label from the no-match list.
      cacheKey = `${id}::exact:${exactDesc.trim().toLowerCase()}`;
      url = `/api/attendingepa/trainees/${id}?exact_desc=${encodeURIComponent(exactDesc.trim())}`;
    } else if (trimmed) {
      cacheKey = `${id}::${trimmed.toLowerCase()}`;
      url = `/api/attendingepa/trainees/${id}?q=${encodeURIComponent(trimmed)}`;
    } else {
      cacheKey = `${id}`;
      url = `/api/attendingepa/trainees/${id}`;
    }

    const cached = traineeDetailCache.current.get(cacheKey);
    if (cached) return { raw: null, detail: cached };

    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();

    if (isDisambiguationResponse(data)) return { raw: data };
    if (!data.success) throw new Error(data.message || 'Failed to load trainee detail');

    const detail: TraineeDetail = { user: data.user, procedures: data.procedures, stats: data.stats };
    traineeDetailCache.current.set(cacheKey, detail);
    return { raw: data, detail };
  }

  async function fetchCohortProc(
    pgy: number | null,
    opts: { phrase?: string; procTypeIds?: number[] } = {},
  ): Promise<{ raw: any; procedures?: CohortProcedureItem[] }> {
    const { phrase, procTypeIds } = opts;

    let cacheKey: string;
    let url: string;

    if (procTypeIds && procTypeIds.length > 0) {
      const idsStr = procTypeIds.sort().join(',');
      cacheKey = `cohort::${pgy ?? 'all'}::ids:${idsStr}`;
      url = `/api/attendingepa/cohortproc?proc_type_ids=${encodeURIComponent(idsStr)}${pgy != null ? `&pgy=${pgy}` : ''}`;
    } else if (phrase?.trim()) {
      cacheKey = `cohort::${pgy ?? 'all'}::${phrase.trim().toLowerCase()}`;
      url = `/api/attendingepa/cohortproc?q=${encodeURIComponent(phrase.trim())}${pgy != null ? `&pgy=${pgy}` : ''}`;
    } else {
      cacheKey = `cohort::${pgy ?? 'all'}`;
      url = pgy ? `/api/attendingepa/cohortproc?pgy=${pgy}` : '/api/attendingepa/cohortproc';
    }

    const cached = cohortCache.current.get(cacheKey);
    if (cached) return { raw: null, procedures: cached };

    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();

    if (isDisambiguationResponse(data)) return { raw: data };
    if (!data.success) throw new Error(data.message || 'Failed to load cohort data');

    cohortCache.current.set(cacheKey, data.procedures);
    return { raw: data, procedures: data.procedures };
  }

  async function loadCohortVocab(pgy: number | null): Promise<CohortProcedureItem[]> {
    const result = await fetchCohortProc(pgy);
    if (!result.procedures) throw new Error('Failed to load cohort vocab');
    return result.procedures;
  }

  // ─── Response builders ──────────────────────────────────────────────────────

  async function respondForTrainee(
    trainee: TraineeListItem,
    remainder: string,
    explicitPgy: number | null,
    procTypeIds?: number[],
    exactDesc?: string,
  ) {
    const baseline = await fetchTraineeDetail(trainee.user_id);
    if (!baseline.detail) throw new Error('Failed to load trainee baseline');

    if (!remainder.trim() && !procTypeIds?.length) {
      append({ id: uid(), role: 'bot', kind: 'trainee-overview', trainee, detail: baseline.detail });
      return;
    }

    const filtered = await fetchTraineeDetail(trainee.user_id, {
      phrase: (procTypeIds?.length || exactDesc) ? undefined : remainder,
      procTypeIds,
      exactDesc,
    });

    if (filtered.raw && isDisambiguationResponse(filtered.raw)) {
      append({
        id: uid(), role: 'bot', kind: 'ambiguous-procedure',
        candidates: filtered.raw.disambiguation.candidates,
        matchedAlias: filtered.raw.disambiguation.matchedAlias,
        originalQuery: remainder,
        trainee,
        pendingPgy: explicitPgy,
      });
      return;
    }

    if (!filtered.detail || filtered.detail.procedures.length === 0) {
      append(noMatchMessage(trainee, baseline.detail, remainder, explicitPgy));
      return;
    }

    const { matched, source } = pickMatchSet(filtered.detail.procedures);
    const groupSummary = summarizeProcedureGroups(matched);
    if (!groupSummary) {
      append(noMatchMessage(trainee, baseline.detail, remainder, explicitPgy));
      return;
    }

    const cohort = await loadCohortVocab(explicitPgy ?? trainee.pgy ?? null);

    if (source === 'dictation' && filterCohortByPhrase(cohort, remainder).length === 0) {
      append(noMatchMessage(trainee, baseline.detail, remainder, explicitPgy));
      return;
    }

    const drilldown = buildProcedureDrilldown(matched, groupSummary.label);
    const cohortAvg = aggregateCohort(
      procTypeIds?.length ? cohort : filterCohortByPhrase(cohort, remainder),
    );

    append({
      id: uid(), role: 'bot', kind: 'procedure-drilldown',
      trainee, drilldown, matchSource: source, cohortAvg,
      pgyUsed: explicitPgy ?? trainee.pgy, groupSummary,
    });
  }

  async function respondForCohortOnly(
    remainder: string,
    explicitPgy: number | null,
    procTypeIds?: number[],
  ) {
    const result = await fetchCohortProc(explicitPgy, {
      phrase: procTypeIds?.length ? undefined : remainder,
      procTypeIds,
    });

    if (result.raw && isDisambiguationResponse(result.raw)) {
      append({
        id: uid(), role: 'bot', kind: 'ambiguous-procedure',
        candidates: result.raw.disambiguation.candidates,
        matchedAlias: result.raw.disambiguation.matchedAlias,
        originalQuery: remainder,
        trainee: null,
        pendingPgy: explicitPgy,
      });
      return;
    }

    const procedures = result.procedures;
    if (!procedures) throw new Error('Failed to load cohort procedures');

    const matches = procTypeIds?.length ? procedures : filterCohortByPhrase(procedures, remainder);

    if (matches.length === 0) {
      if (explicitPgy != null) {
        const cohort = await loadCohortVocab(explicitPgy);
        append(cohortNoMatchMessage(remainder, explicitPgy, cohort));
      } else {
        append({ id: uid(), role: 'bot', kind: 'help', text: `I couldn't find a trainee or procedure matching "${remainder}". Try a last name plus a procedure, e.g. "Smith G-tube".` });
      }
      return;
    }

    const cohortAvg = aggregateCohort(matches);
    const groupSummary = summarizeCohortGroups(matches);

    if (!cohortAvg || !groupSummary) {
      if (explicitPgy != null) {
        const cohort = await loadCohortVocab(explicitPgy);
        append(cohortNoMatchMessage(remainder, explicitPgy, cohort));
      } else {
        append({ id: uid(), role: 'bot', kind: 'help', text: `I couldn't find a trainee or procedure matching "${remainder}". Try a last name plus a procedure, e.g. "Smith G-tube".` });
      }
      return;
    }

    append({ id: uid(), role: 'bot', kind: 'cohort-only', groupSummary, cohortAvg, pgyUsed: explicitPgy });
  }

  // ─── Event handlers ─────────────────────────────────────────────────────────

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

  async function handleAmbiguousTraineePick(candidate: TraineeMatch, pendingRemainder: string, pendingPgy: number | null) {
    setLoading(true);
    try {
      await respondForTrainee(candidate.trainee, pendingRemainder, pendingPgy);
    } catch (e: any) {
      append({ id: uid(), role: 'bot', kind: 'error', text: e?.message || 'Something went wrong fetching that data.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleProcedureDisambiguationSubmit(
    msg: Extract<ChatMessage, { kind: 'ambiguous-procedure' }>,
    selectedIds: number[],
  ) {
    if (selectedIds.length === 0) return;
    setLoading(true);
    try {
      if (msg.trainee) {
        await respondForTrainee(msg.trainee, msg.originalQuery, msg.pendingPgy, selectedIds);
      } else {
        await respondForCohortOnly(msg.originalQuery, msg.pendingPgy, selectedIds);
      }
    } catch (e: any) {
      append({ id: uid(), role: 'bot', kind: 'error', text: e?.message || 'Something went wrong fetching that data.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleKnownProcedurePick(trainee: TraineeListItem, label: string, pgyUsed: number | null) {
    setLoading(true);
    try {
      // Pass label as exactDesc so it goes straight to a ProcedureDescList = ?
      // match on the server, bypassing alias resolution entirely.
      await respondForTrainee(trainee, label, pgyUsed, undefined, label);
    } catch (e: any) {
      append({ id: uid(), role: 'bot', kind: 'error', text: e?.message || 'Something went wrong fetching that data.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectCohortProcedure(label: string, pgyUsed: number | null) {
    setLoading(true);
    try {
      await respondForCohortOnly(label, pgyUsed);
    } catch (e: any) {
      append({ id: uid(), role: 'bot', kind: 'error', text: e?.message || 'Something went wrong fetching that data.' });
    } finally {
      setLoading(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

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

            {messages.map(m => (
              <MessageBubble
                key={m.id}
                msg={m}
                onPickAmbiguousTrainee={handleAmbiguousTraineePick}
                onProcedureDisambiguationSubmit={handleProcedureDisambiguationSubmit}
                onSelectKnownProcedure={handleKnownProcedurePick}
                onSelectCohortProcedure={handleSelectCohortProcedure}
              />
            ))}

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
          <div className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 w-56 rounded bg-slate-600 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-75 group-hover:opacity-100 group-focus:opacity-100">
            Ask about a trainee's performance on a procedure.
          </div>
          <button
            onClick={() => setOpen(true)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ffc48c] text-white shadow-lg hover:bg-[#ffc48c]/80"
            aria-label="Open EPA lookup"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.81,16.23,20,21l-4.95-2.48A9.84,9.84,0,0,1,12,19c-5,0-9-3.58-9-8s4-8,9-8,9,3.58,9,8A7.49,7.49,0,0,1,18.81,16.23Z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Procedure disambiguation card (multi-select) ─────────────────────────────

type AmbiguousProcedureMsg = Extract<ChatMessage, { kind: 'ambiguous-procedure' }>;

function ProcedureDisambiguationCard({
  msg, onSubmit,
}: {
  msg: AmbiguousProcedureMsg;
  onSubmit: (msg: AmbiguousProcedureMsg, selectedIds: number[]) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleSubmit() {
    if (selected.size === 0 || submitted) return;
    setSubmitted(true);
    onSubmit(msg, Array.from(selected));
  }

  const aliasLabel = msg.matchedAlias ? `"${msg.matchedAlias}"` : `"${msg.originalQuery}"`;
  const contextLabel = msg.trainee ? ` for ${displayName(msg.trainee)}` : '';

  return (
    <Card>
      <p className="text-xs font-medium text-slate-600">
        {aliasLabel} matches multiple procedures{contextLabel}. Select all that apply:
      </p>
      <div className="space-y-1.5">
        {msg.candidates.map(c => {
          const checked = selected.has(c.proc_type_id);
          return (
            <button
              key={c.proc_type_id}
              type="button"
              onClick={() => !submitted && toggle(c.proc_type_id)}
              disabled={submitted}
              className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors
                ${checked ? 'border-slate-400 bg-slate-100 text-slate-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}
                ${submitted ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${checked ? 'border-slate-500 bg-slate-500' : 'border-slate-300 bg-white'}`}>
                {checked && (
                  <svg viewBox="0 0 10 8" className="h-2 w-2 text-white" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M1 4l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="flex-1">
                <span className="block font-medium leading-tight">{c.proc_desc}</span>
                {c.proc_code && <span className="text-slate-400">{c.proc_code}</span>}
                {c.proc_cat && <span className="ml-1 text-slate-400">· {c.proc_cat}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={selected.size === 0 || submitted}
        className="mt-1 w-full rounded-lg bg-slate-700 py-1.5 text-xs font-medium text-white disabled:opacity-40 hover:bg-slate-800 transition-colors"
      >
        {submitted ? 'Loading…' : `Show results${selected.size > 1 ? ` (${selected.size} selected)` : ''}`}
      </button>
    </Card>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ProcedureGroupToggle({ groupSummary, expanded, onToggle }: {
  groupSummary: ProcedureGroupSummary; expanded: boolean; onToggle: () => void;
}) {
  if (groupSummary.groupCount <= 1) return null;
  const tooltip = expanded ? 'Hide list of procedure types' : 'Show list of procedure types';
  return (
    <button type="button" onClick={onToggle} title={tooltip} aria-label={tooltip} aria-expanded={expanded}
      className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
        className={`h-3.5 w-3.5 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

function ProcedureGroupList({ groups }: { groups: { label: string; count: number }[] }) {
  return (
    <div className="max-h-28 space-y-0.5 overflow-y-auto rounded-lg bg-slate-50 px-2 py-1.5">
      {groups.map(g => (
        <div key={g.label} className="flex justify-between gap-2 text-xs text-slate-500">
          <span className="truncate">{g.label}</span>
          <span className="whitespace-nowrap text-slate-400">{g.count}×</span>
        </div>
      ))}
    </div>
  );
}

type ProcedureDrilldownMessage = Extract<ChatMessage, { kind: 'procedure-drilldown' }>;
type CohortOnlyMessage = Extract<ChatMessage, { kind: 'cohort-only' }>;

function ProcedureDrilldownCard({ msg }: { msg: ProcedureDrilldownMessage }) {
  const [expanded, setExpanded] = useState(false);
  const { trainee, drilldown, matchSource, cohortAvg, pgyUsed, groupSummary } = msg;
  const trend = TREND_LABEL[drilldown.trend];
  return (
    <Card>
      <div className="flex items-center gap-1">
        <CardTitle>{displayName(trainee)} · {drilldown.procedureLabel}</CardTitle>
        <ProcedureGroupToggle groupSummary={groupSummary} expanded={expanded} onToggle={() => setExpanded(v => !v)} />
      </div>
      {expanded && groupSummary.groupCount > 1 && <ProcedureGroupList groups={groupSummary.allGroups} />}
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
          {pgyUsed ? `PGY-${pgyUsed} Cohort Avg` : 'Cohort Avg'}: {cohortAvg.avg ?? '—'} ({cohortAvg.count} scored of {cohortAvg.totalCount} cases)
        </p>
      )}
    </Card>
  );
}

function CohortOnlyCard({ msg }: { msg: CohortOnlyMessage }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card>
      <div className="flex items-center gap-1">
        <CardTitle>{msg.pgyUsed ? `PGY-${msg.pgyUsed} · ` : ''}{msg.groupSummary.label}</CardTitle>
        <ProcedureGroupToggle groupSummary={msg.groupSummary} expanded={expanded} onToggle={() => setExpanded(v => !v)} />
      </div>
      {expanded && msg.groupSummary.groupCount > 1 && <ProcedureGroupList groups={msg.groupSummary.allGroups} />}
      <Stat label="Cohort Avg EPA:" value={msg.cohortAvg.avg ?? '—'} sub={`${msg.cohortAvg.count} scored of ${msg.cohortAvg.totalCount} cases`} />
    </Card>
  );
}

// ─── Message bubble dispatcher ───────────────────────────────────────────────

function MessageBubble({
  msg, onPickAmbiguousTrainee, onProcedureDisambiguationSubmit,
  onSelectKnownProcedure, onSelectCohortProcedure,
}: {
  msg: ChatMessage;
  onPickAmbiguousTrainee: (c: TraineeMatch, remainder: string, pgy: number | null) => void;
  onProcedureDisambiguationSubmit: (msg: Extract<ChatMessage, { kind: 'ambiguous-procedure' }>, ids: number[]) => void;
  onSelectKnownProcedure: (trainee: TraineeListItem, label: string, pgyUsed: number | null) => void;
  onSelectCohortProcedure: (label: string, pgyUsed: number | null) => void;
}) {
  if (msg.role === 'user') {
    return <div className="ml-auto max-w-[85%] rounded-2xl bg-slate-600 px-3 py-2 text-sm text-white">{msg.text}</div>;
  }

  switch (msg.kind) {
    case 'help':
    case 'error':
      return (
        <div className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${msg.kind === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
          {msg.text}
        </div>
      );

    case 'ambiguous-trainee':
      return (
        <div className="max-w-[90%] space-y-2 rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-600">
          <p>Did you mean:</p>
          <div className="flex flex-wrap gap-2">
            {msg.candidates.map(c => (
              <button
                key={c.trainee.user_id}
                onClick={() => onPickAmbiguousTrainee(c, msg.pendingRemainder, msg.pendingPgy)}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50"
              >
                {displayName(c.trainee)} {c.trainee.pgy ? `(PGY-${c.trainee.pgy})` : ''}
              </button>
            ))}
          </div>
        </div>
      );

    case 'ambiguous-procedure':
      return <ProcedureDisambiguationCard msg={msg} onSubmit={onProcedureDisambiguationSubmit} />;

    case 'trainee-overview': {
      const { trainee, detail } = msg;
      const top = topProcedureBreakdown(detail.procedures, 5);
      return (
        <Card>
          <CardTitle>{displayName(trainee)}{trainee.pgy ? ` · PGY-${trainee.pgy}` : ''}</CardTitle>
          <Stat label="Average EPA" value={detail.stats.avg_epa || '—'} />
          <Stat label="Total reports" value={detail.stats.total_reports} />
          <Stat label="Cases this month" value={detail.stats.procedures} />
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

    case 'procedure-drilldown':
      return <ProcedureDrilldownCard msg={msg} />;

    case 'cohort-only':
      return <CohortOnlyCard msg={msg} />;

    case 'cohort-no-match':
      return (
        <Card>
          <CardTitle>No "{msg.phrase}" cases for {msg.pgyUsed ? `PGY-${msg.pgyUsed}` : 'this cohort'}</CardTitle>
          {msg.knownProcedures.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-slate-500">On file for this cohort — tap to view:</p>
              {msg.knownProcedures.map(p =>
                p.label === 'Unknown' ? (
                  <div key={p.label} className="flex justify-between text-xs text-slate-500">
                    <span className="truncate pr-2">{p.label}</span>
                    <span className="text-slate-400">{p.count}×</span>
                  </div>
                ) : (
                  <button
                    key={p.label}
                    onClick={() => onSelectCohortProcedure(p.label, msg.pgyUsed)}
                    className="flex w-full items-center justify-between rounded-lg px-1 py-0.5 text-left text-xs text-slate-600 hover:bg-slate-50"
                  >
                    <span className="truncate pr-2">{p.label}</span>
                    <span className="whitespace-nowrap text-slate-400">{p.count}×</span>
                  </button>
                )
              )}
            </div>
          )}
        </Card>
      );

    case 'no-match': {
      const { suggestions } = msg;
      const header = suggestions.related
        ? `No "${msg.phrase}" on record — did you mean:`
        : `No "${msg.phrase}" cases for ${msg.traineeName}`;
      const subheader = suggestions.related
        ? null
        : suggestions.items.length > 0 ? 'On file for this trainee — tap to view:' : null;
      return (
        <Card>
          <CardTitle>{header}</CardTitle>
          {subheader && <p className="text-xs text-slate-500">{subheader}</p>}
          {suggestions.items.length > 0 && (
            <div className="space-y-1">
              {suggestions.items.map(p =>
                p.label === 'Unknown' ? (
                  <div key={p.label} className="flex justify-between text-xs text-slate-500">
                    <span className="truncate pr-2">{p.label}</span>
                    <span className="text-slate-400">{p.count}×</span>
                  </div>
                ) : (
                  <button
                    key={p.label}
                    onClick={() => onSelectKnownProcedure(msg.trainee, p.label, msg.pgyUsed)}
                    className="flex w-full items-center justify-between rounded-lg px-1 py-0.5 text-left text-xs text-slate-600 hover:bg-slate-50"
                  >
                    <span className="truncate pr-2">{p.label}</span>
                    <span className="whitespace-nowrap text-slate-400">
                      {p.count}× {p.avg != null ? `· avg ${p.avg}` : ''}
                    </span>
                  </button>
                )
              )}
            </div>
          )}
        </Card>
      );
    }
  }
}

// ─── Primitives ───────────────────────────────────────────────────────────────

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
      <span className="text-right text-slate-700">
        {value}
        {sub && <span className="ml-1 text-xs text-slate-400">{sub}</span>}
      </span>
    </div>
  );
}