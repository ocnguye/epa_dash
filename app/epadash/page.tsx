'use client';

/* Imports */
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { computeAdjustedEPA, type AdjustedEPAInput } from '@/lib/adjustedEpa';
import  ProgressCircle from "@/components/ProgressCircle";
import SeekFeedbackChart from "@/components/SeekFeedbackChart";
import KeyPerformanceMetrics from "@/components/KeyPerformanceMetrics";
import ProcedureLogTable, { type Procedure } from '@/components/ProcedureLogTable';
import { 
    epaTrendOptions, 
    complexityVsEpaOptions, 
    procedureSpecificOptions,
    hoverSlopePlugin 
} from "@/components/ChartConfigs";
import { Line, Bar, Scatter } from 'react-chartjs-2';
import ChartTrendline from 'chartjs-plugin-trendline';
import { 
    Chart as ChartJS, 
    CategoryScale, 
    LinearScale, 
    PointElement, 
    LineElement, 
    BarElement,
    Title, 
    Tooltip, 
    Legend,
    Filler, 
    ChartOptions, 
} from 'chart.js';
import { useRouter } from 'next/navigation';
import DashboardToggle from '@/components/DashboardToggle';
import ReportProgressCircle from '@/components/ReportProgressCircle';

ChartJS.register(
    CategoryScale, 
    LinearScale, 
    PointElement, 
    LineElement, 
    BarElement,
    Title, 
    Tooltip, 
    Legend,
    ChartTrendline,
    Filler,
    hoverSlopePlugin,
);

/* Types */
type User = {
    first_name: string;
    last_name: string;
    role: string;
    specialty: string | null;
    rotation: string | null;
};

type Stats = {
    avg_epa: number;
    procedures: number;
    feedback_requested: number;
    total_procedures: number;
    total_reports: number;
};

// helper function to get feedback status
const getFeedbackStatus = (seekFeedback: string | number) => {
    // Handle both ENUM string values and legacy numeric values
    const status = typeof seekFeedback === 'string' ? seekFeedback : 
                   seekFeedback === 0 ? 'not_required' :
                   seekFeedback === 1 ? 'feedback_requested' :
                   seekFeedback === 2 ? 'discussed' : 'not_required';
    
    switch(status) {
        case 'not_required': return { text: 'Not Required', color: '#6c757d', bgColor: '#f8f9fa' };
        case 'feedback_requested': return { text: 'Feedback Requested', color: '#856404', bgColor: '#fff3cd' };
        case 'discussed': return { text: 'Discussed', color: '#155724', bgColor: '#d4edda' };
        default: return { text: 'Unknown', color: '#721c24', bgColor: '#f8d7da' };
    }
};

// helper function to describe status
const getStatusDescription = (status: string) => {
    switch(status) {
        case 'not_required': return "Attending does not require a follow-up for feedback.";
        case 'feedback_requested': return "Attending requests follow-up from trainee within 24 hours for feedback.";
        case 'discussed': return "Trainee has discussed the procedure with the attending and no further action is required.";
        default: return "Unknown";
    }
};

// helper to truncate long text
const truncateText = (txt?: string | null, n = 40) => {
    if (!txt) return '';
    const s = String(txt).trim();
    return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
};

/* Dashboard Component */
export default function Dashboard() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [stats, setStats] = useState<Stats>({
        avg_epa: 0,
        procedures: 0,
        feedback_requested: 0,
        total_procedures: 0,
        total_reports: 0,
    });
    const [procedures, setProcedures] = useState<Procedure[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState('EPA Trend');
        const [timeframe, setTimeframe] = useState<'last_month' | 'last_6_months' | 'last_year' | 'all'>('all');
    // procedure filter for EPA Trend
    const [selectedProcedure, setSelectedProcedure] = useState<string>('all');
    // PROCEDURE COUNTS view timeframe (monthly / annual)
    const [countsGranularity, setCountsGranularity] = useState<'monthly' | 'annual'>('monthly');
    // selected procedure for the PROCEDURE COUNTS view (separate from the EPA TREND filter)
    const [countsSelectedProcedure, setCountsSelectedProcedure] = useState<string>('all');
    // Chart container ref + dynamic tab sizing
    const chartContainerRef = useRef<HTMLDivElement | null>(null);
    const [chartContainerWidth, setChartContainerWidth] = useState<number>(0);
    const [chartInnerLeft, setChartInnerLeft] = useState<number>(0);
    const [chartInnerWidth, setChartInnerWidth] = useState<number>(0);
    const tabs = ['EPA Trend', 'Procedure-Specific EPA', 'Procedure Counts'];
    const [procSortAsc, setProcSortAsc] = useState(true);
    const tabOverlap = 12; // pixels of overlap between adjacent tabs
    const [evaluatorStats, setEvaluatorStats] = useState<Record<number, { mean: number; stdDev: number }>>({});
    const [procedureMedians, setProcedureMedians] = useState<Record<string, { complexity: 1|2|3|4|5|null; fluoroTimeMedian: number|null; radiationDoseMedian: number|null }>>({});
    const [adjustedStatsLoading, setAdjustedStatsLoading] = useState(true);

    useEffect(() => {
        const el = chartContainerRef.current;
        if (!el || typeof ResizeObserver === 'undefined') {
            if (el) setChartContainerWidth(el.clientWidth || 0);
            return;
        }

        const compute = (target: HTMLElement) => {
            try {
                const style = window.getComputedStyle(target);
                const pl = parseFloat(style.paddingLeft || '0') || 0;
                const pr = parseFloat(style.paddingRight || '0') || 0;
                const parent = target.parentElement as HTMLElement | null;
                const parentRect = parent ? parent.getBoundingClientRect() : { left: 0 } as DOMRect;
                const rect = target.getBoundingClientRect();
                // left relative to positioned parent + left padding so tabs sit flush with content
                const left = Math.max(0, Math.floor(rect.left - parentRect.left + pl));
                const innerW = Math.max(0, Math.floor(target.clientWidth - pl - pr));
                setChartInnerLeft(left);
                setChartInnerWidth(innerW);
                setChartContainerWidth(Math.floor(target.clientWidth));
            } catch (err) {
                setChartInnerLeft(target.offsetLeft || 0);
                setChartInnerWidth(target.clientWidth || 0);
                setChartContainerWidth(target.clientWidth || 0);
            }
        };

        // observe size changes
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                const target = entry.target as HTMLElement;
                compute(target);
            }
        });
        ro.observe(el);
        // initial measurement
        compute(el);
        return () => ro.disconnect();
    }, [chartContainerRef]);

    const { baseTabWidth, lastTabWidth, containerWidthForTabs } = (() => {
        const count = tabs.length;
        // Use the inner content width so tabs line up with the chart content area
        if (!count || !chartInnerWidth) return { baseTabWidth: 200, lastTabWidth: 200, containerWidthForTabs: 200 };
        // Calculate tab width so the visible group of overlapped tabs exactly fills
        // the chart inner content width. With per-tab width W and overlap O, the
        // total occupied width = count*W - (count-1)*O. Solve for W:
        // W = (chartInnerWidth + (count-1)*O) / count
        const overlapTotal = tabOverlap * (count - 1);
        const raw = (chartInnerWidth + overlapTotal) / count;
        const base = Math.floor(raw);
        // Distribute any leftover pixels across tabs to avoid a right-side gap
        const occupied = count * base - overlapTotal;
        const remainder = chartInnerWidth - occupied;
        const extraPer = remainder > 0 ? Math.floor(remainder / count) : 0;
        const lastExtra = remainder > 0 ? remainder - (extraPer * count) : 0;
        const baseAdjusted = base + extraPer;
        const last = baseAdjusted + lastExtra;
        const min = 34; // allow compact tabs when many are present
        return { baseTabWidth: baseAdjusted > min ? baseAdjusted : min, lastTabWidth: last > min ? last : min, containerWidthForTabs: chartInnerWidth };
    })();
    // Profile modal state
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [profileForm, setProfileForm] = useState({ username: '', password: '', confirm_password: '', preferred_name: '', first_name: '', last_name: '', role: '', pgy: '' });
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [profileSuccess, setProfileSuccess] = useState('');

    // function to fetch dashboard data
    const fetchDashboard = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/dashboard');
            if (!res.ok) throw new Error('Failed to fetch dashboard data');
            const data = await res.json();
            setUser(data.user || null);
            setStats(data.stats || {});
            setProcedures(data.procedures || []);
            // evaluatorStats is now returned by the dashboard API alongside procedures
            // so we don't need a separate fetch — set it here directly.
            if (data.evaluatorStats) setEvaluatorStats(data.evaluatorStats);
        } catch (err: any) {
            setError(err.message || 'Error loading dashboard');
        }
        setLoading(false);
        setAdjustedStatsLoading(false);
    };

    // fetch adjusted EPA stats for evaluator benchmarking and procedure-specific medians
    const fetchAdjustedEpaStats = async () => {
        setAdjustedStatsLoading(true);
        try {
            const res = await fetch('/api/adjustedEpaStats');
            if (!res.ok) return;
            const data = await res.json();
            // evaluatorStats comes from /api/dashboard now — only take procedureMedians here
            if (data.procedureMedians) setProcedureMedians(data.procedureMedians);
        } catch (e) {
            console.error('Failed to fetch adjusted EPA stats', e);
        } finally {
            setAdjustedStatsLoading(false);
        }
    };

    // Fetch cohort average EPA for the selected procedure (or overall when proc not provided).
    // This keeps the peer cohort line in the chart in sync with the procedure filter.
    const fetchCohortAvg = async (proc?: string) => {
        try {
            const url = proc && proc !== 'all' ? `/api/dashboard?proc=${encodeURIComponent(proc)}` : '/api/dashboard';
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json();
            // Only update the cohort average field so we don't clobber trainee-specific stats
            if (data && data.stats && typeof (data.stats as any).cohort_avg_epa !== 'undefined') {
                setStats(prev => ({ ...prev, cohort_avg_epa: Number((data.stats as any).cohort_avg_epa) || 0 } as any));
            }
        } catch (e) {
            // non-fatal; keep existing cohort avg
            // eslint-disable-next-line no-console
            console.error('Failed to fetch cohort average for procedure filter', e);
        }
    };

    // Function to update procedure status (optional notes for feedback requests)
    const updateProcedureStatus = async (reportId: number, newStatus: string, notes?: string) => {
        try {
            const response = await fetch(`/api/procedures/${reportId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status: newStatus, notes }),
            });

            if (response.ok) {
                // Update local state
                setProcedures(prev => 
                    prev.map(proc => 
                        proc.report_id === reportId 
                            ? { ...proc, seek_feedback: newStatus as 'not_required' | 'feedback_requested' | 'discussed' }
                            : proc
                    )
                );
                // Refresh stats
                fetchDashboard();
            }
        } catch (error) {
            console.error('Failed to update status:', error);
        }
    };

    // Open profile modal and prefill form from user state
    const openProfileModal = () => {
        setProfileError('');
        setProfileSuccess('');
        setProfileForm({
            username: (user as any)?.username ?? '',
            password: '',
            confirm_password: '',
            preferred_name: (user as any)?.preferred_name ?? '',
            first_name: (user as any)?.first_name ?? '',
            last_name: (user as any)?.last_name ?? '',
            role: (user as any)?.role ?? '',
            pgy: typeof (user as any)?.pgy !== 'undefined' && (user as any)?.pgy !== null ? String((user as any).pgy) : '',
        });
        setShowProfileModal(true);
    };

    const closeProfileModal = () => {
        setShowProfileModal(false);
        setProfileLoading(false);
        setProfileError('');
        setProfileSuccess('');
    };

    const submitProfileUpdate = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setProfileError('');
        setProfileSuccess('');

        // basic client-side validation
        if (profileForm.password && profileForm.password.length > 0 && profileForm.password.length < 8) {
            setProfileError('Password must be at least 8 characters');
            return;
        }
        // If a new password was supplied, ensure confirmation matches
        if (profileForm.password && profileForm.password.length > 0) {
            if ((profileForm.confirm_password ?? '') !== profileForm.password) {
                setProfileError('New password and confirmation do not match');
                return;
            }
        }

        setProfileLoading(true);
            try {
            const payload: any = {};
            if (profileForm.username && profileForm.username !== (user as any)?.username) payload.username = profileForm.username;
            if (profileForm.password) payload.password = profileForm.password;
            if (typeof profileForm.preferred_name !== 'undefined') payload.preferred_name = profileForm.preferred_name;
            if (typeof profileForm.first_name !== 'undefined' && profileForm.first_name !== (user as any)?.first_name) payload.first_name = profileForm.first_name;
            if (typeof profileForm.last_name !== 'undefined' && profileForm.last_name !== (user as any)?.last_name) payload.last_name = profileForm.last_name;
            if (typeof profileForm.pgy !== 'undefined') {
                const pgyVal = profileForm.pgy === '' ? undefined : Number(profileForm.pgy);
                if (typeof pgyVal !== 'undefined' && Number.isInteger(pgyVal)) payload.pgy = pgyVal;
            }
            // only include role if user is admin (server will also enforce this)
            if (typeof profileForm.role !== 'undefined' && (user as any)?.role === 'admin' && profileForm.role !== (user as any)?.role) payload.role = profileForm.role;

            const res = await fetch('/api/user', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await res.json();
            if (!res.ok) {
                setProfileError(data?.message || 'Failed to update profile');
            } else {
                setProfileSuccess(data?.message || 'Profile updated');
                // refresh dashboard user info
                await fetchDashboard();
                // close automatically after a short delay
                setTimeout(() => closeProfileModal(), 900);
            }
        } catch (err: any) {
            setProfileError(err?.message || 'Server error');
        } finally {
            setProfileLoading(false);
        }
    };

    // Note: creation of feedback requests is handled outside this trainee UI.
    // Trainees can only mark a previously requested feedback as 'discussed'.

    useEffect(() => {
        fetchDashboard();
        fetchAdjustedEpaStats();
    }, []);

    // When the selected procedure filter changes, request a procedure-scoped cohort average
    // so the peer cohort line reflects the filter.
    useEffect(() => {
        // Only update cohort average (server will return overall when proc omitted)
        fetchCohortAvg(selectedProcedure);
    }, [selectedProcedure]);

    const feedbackRate = stats.total_procedures ? (stats.feedback_requested / stats.total_procedures) * 100 : 0;
    const parseDate = (d: string) => new Date(d.replace('Z', ''));
    
    // filter procedures by timeframe for charts/tables
    const filteredProcedures = useMemo(() => {
        if (!procedures || procedures.length === 0) return [] as Procedure[];
        if (timeframe === 'all') return procedures;
        const now = new Date();
        let cutoff: Date;
        if (timeframe === 'last_month') {
            cutoff = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30);
        } else if (timeframe === 'last_6_months') {
            cutoff = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30 * 6);
        } else {
            // last_year
            cutoff = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 365);
        }
        return procedures.filter(p => {
            const d = new Date(parseDate(p.create_date));
            return d >= cutoff;
        });
    }, [procedures, timeframe]);

    // Procedure options (code or description) for the procedure filter dropdown
    const procedureOptions = useMemo(() => {
        const map: Record<string, string> = {};
        procedures.forEach(p => {
            const key = (p.proc_code && String(p.proc_code).trim()) || (p.proc_desc && String(p.proc_desc).trim()) || 'Unknown';
            if (!map[key]) {
                // label: always use an abbreviated/truncated procedure description where possible
                const label = truncateText(p.proc_desc || p.proc_code || 'Unknown', 40);
                map[key] = label;
            }
        });
        const entries = Object.keys(map).map(k => ({ key: k, label: map[k] }));
        // sort alphabetically by label
        entries.sort((a, b) => a.label.localeCompare(b.label));
        return entries;
    }, [procedures]);

    // procedures after applying the procedure-type filter (in addition to timeframe)
    const displayProcedures = useMemo(() => {
        if (!filteredProcedures || filteredProcedures.length === 0) return [] as Procedure[];
        if (!selectedProcedure || selectedProcedure === 'all') return filteredProcedures;
        return filteredProcedures.filter(p => {
            const key = (p.proc_code && String(p.proc_code).trim()) || (p.proc_desc && String(p.proc_desc).trim()) || 'Unknown';
            return key === selectedProcedure;
        });
    }, [filteredProcedures, selectedProcedure]);

    const chartData = useMemo(() => {
    if (!displayProcedures.length) return null;
    // EPA Trend Data - chronological order
    const sortedProcedures = [...displayProcedures].sort((a, b) => new Date(parseDate(a.create_date)).getTime() - new Date(parseDate(b.create_date)).getTime());

        // Helper formatters
        const fmtDay = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD
        const dayLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
        const monthLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    let epaLabels: string[] = [];
    let epaData: Array<number | null> = [];
    // precise ISO-like timestamps matching each label (YYYY-MM-DD or YYYY-MM-01 for months)
    let epaTimestamps: string[] = [];
    let epaReportCounts: number[] = [];

        if (timeframe === 'all') {
            // Aggregate by day (same as last_month but without a fixed window)
            const map: Record<string, { sum: number; count: number }> = {};
            const orderedKeys: string[] = [];

            sortedProcedures.forEach(p => {
                const k = fmtDay(new Date(parseDate(p.create_date)));
                if (!map[k]) { map[k] = { sum: 0, count: 0 }; orderedKeys.push(k); }
                const v = Number(p.oepa);
                if (Number.isFinite(v) && v > 0) {  // ← add v > 0 guard
                    map[k].sum += v;
                    map[k].count += 1;
                }
            });

            epaLabels = orderedKeys.map(k => {
                const [y, m, d] = k.split('-');
                return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            });
            epaData = orderedKeys.map(k => 
                map[k].count ? Number((map[k].sum / map[k].count).toFixed(2)) : null
            );
            epaTimestamps = orderedKeys.map(k => `${k}T00:00:00`);
            epaReportCounts = orderedKeys.map(k => map[k].count ?? 0);
        } else {
            // build buckets depending on timeframe
            const now = new Date();
            let buckets: string[] = [];
            if (timeframe === 'last_month') {
                // last 30 days
                for (let i = 29; i >= 0; i--) {
                    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
                    buckets.push(fmtDay(d));
                }
                // aggregate by day
                const map: Record<string, { sum: number; count: number }> = {};
                sortedProcedures.forEach(p => {
                    const k = fmtDay(new Date(parseDate(p.create_date)));
                    if (!map[k]) map[k] = { sum: 0, count: 0 };
                    const v = Number(p.oepa);
                    if (Number.isFinite(v) && v > 0) { map[k].sum += v; map[k].count += 1; }
                });
                epaLabels = buckets.map(d => {
                    const parts = d.split('-');
                    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                    return dayLabel(date);
                });
                epaData = buckets.map(k => map[k] && map[k].count ? Number((map[k].sum / map[k].count).toFixed(2)) : null);
                epaTimestamps = buckets.slice();
                epaReportCounts = buckets.map(k => map[k]?.count ?? 0);
            } else if (timeframe === 'last_6_months' || timeframe === 'last_year') {
                // months window
                const months = timeframe === 'last_6_months' ? 6 : 12;
                for (let i = months - 1; i >= 0; i--) {
                    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                    buckets.push(monthKey(d));
                }
                // aggregate by month
                const map: Record<string, { sum: number; count: number }> = {};
                sortedProcedures.forEach(p => {
                    const date = new Date(parseDate(p.create_date));
                    const k = monthKey(date);
                    if (!map[k]) map[k] = { sum: 0, count: 0 };
                    const v = Number(p.oepa);
                    if (Number.isFinite(v) && v > 0) {  // ← add v > 0 guard
                        map[k].sum += v;
                        map[k].count += 1;
                    }
                });
                epaLabels = buckets.map(k => {
                    const [y, m] = k.split('-');
                    const d = new Date(Number(y), Number(m) - 1, 1);
                    return monthLabel(d);
                });
                epaData = buckets.map(k => map[k] && map[k].count ? Number((map[k].sum / map[k].count).toFixed(2)) : null);
                epaTimestamps = buckets.map(k => `${k}-01T00:00:00`);
                epaReportCounts = buckets.map(k => map[k]?.count ?? 0);
            }
        }

        const cohortAvg = (typeof (stats as any)?.cohort_avg_epa === 'number') ? (stats as any).cohort_avg_epa : 0;

        const epaDatasets: any[] = [];
        epaDatasets.push({
            label: 'EPA Score',
            data: epaData,
            spanGaps: true, // allow gaps to be filled for areas missing EPA data
            timestamps: epaTimestamps.map(ts => ts),
            reportCounts: epaReportCounts,
            borderColor: '#afd5f0',
            backgroundColor: 'rgba(74, 144, 226, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#afd5f0',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 6,
            // TRENDLINE: comment this block out to disable
            trendlineLinear: {
                colorMin: 'rgba(178, 211, 194, 0.6)',
                colorMax: 'rgba(178, 211, 194, 0.6)',
                lineStyle: 'dotted',
                width: 2,
            },
            // END TRENDLINE
        });
        if (cohortAvg && cohortAvg > 0) {
            epaDatasets.push({
                label: 'Peer Cohort',
                data: epaLabels.map(() => Number(cohortAvg)),
                cohortValue: Number(cohortAvg),
                // attach PGY for tooltip/title display
                cohortPgy: (user && typeof (user as any).pgy !== 'undefined') ? (user as any).pgy : null,
                borderColor: '#ffe26c',
                backgroundColor: 'rgba(255, 226, 108, 0.12)',
                borderWidth: 2,
                fill: false,
                tension: 0.4,
                borderDash: [6, 4],
                // remove visible points on the cohort line but keep a generous hover/hit area
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHitRadius: 5,
                // also allow a slightly larger interactive area
                hoverBorderWidth: 2,
            });
        }

        const epaTrendData = {
            labels: epaLabels,
            datasets: epaDatasets
        };

        const complexityVsEpaData = {
            datasets: [
                {
                label: 'Procedures',
                data: filteredProcedures
                    .filter(proc => proc.oepa != null && Number(proc.oepa) > 0)  // ← add filter
                    .map(proc => ({ x: proc.complexity, y: proc.oepa })),
                backgroundColor: '#afd5f0',
                borderColor: '#fff',
                borderWidth: 2,
                pointRadius: 8,
                pointHoverRadius: 10,
                }
            ]
        };

        const procTypeStats = filteredProcedures.reduce((acc, proc) => {
            const key = proc.proc_code || 'Unknown';
            if (!acc[key]) {
                acc[key] = { total: 0, sum: 0, count: 0, desc: proc.proc_desc } as any;
            }
            const oepaNum = Number(proc.oepa);
            const valid = Number.isFinite(oepaNum) && oepaNum > 0;
            if (valid) {
                acc[key].sum = (acc[key].sum || 0) + oepaNum;
                acc[key].count = (acc[key].count || 0) + 1;
            } else {
                acc[key].sum = acc[key].sum || 0;
                acc[key].count = acc[key].count || 0;
            }
            acc[key].total = acc[key].count ? (acc[key].sum / acc[key].count) : 0;
            return acc;
        }, {} as Record<string, { total: number; sum: number; count: number; desc?: string }>);

        const trimProcedureName = (name: string, maxLength = 20): string => {
            const stripped = name.replace(/^\s*(IR|CT)\s+/i, '').trim();
            return stripped.length > maxLength ? stripped.slice(0, maxLength - 1) + '…' : stripped;
        };

        const sortedEntries = Object.values(procTypeStats)
            .filter(stat => stat.count > 0)  // ← exclude procedures with no valid EPA scores
            .sort((a, b) => procSortAsc ? a.total - b.total : b.total - a.total);
        const labels = sortedEntries.map(stat => trimProcedureName(stat.desc || 'Unknown'));
        const descriptions = sortedEntries.map(stat => stat.desc || '');
        const counts = sortedEntries.map(stat => stat.count || 0);
        const procedureSpecificData = {
            labels,
            datasets: [
                {
                    label: 'Average EPA Score',
                    data: sortedEntries.map(stat => Number(stat.total.toFixed(2))),                    // attach descriptions and counts for tooltip callbacks
                    descriptions,
                    counts,
                    backgroundColor: [
                        'rgba(175, 213, 240, 0.6)',
                        'rgba(178, 211, 194, 0.6)', 
                        'rgba(255, 126, 112, 0.6)',
                        'rgba(200, 206, 238, 0.6)',
                        'rgba(255, 226, 108, 0.6)'
                    ],
                    borderColor: [
                        '#afd5f0',
                        '#b2d3c2',
                        '#ff7e70',
                        '#c8ceee',
                        '#ffe26c'
                    ],
                    borderWidth: 2,
                }
            ]
        };

        console.log('STATS OBJECT:', stats);
        console.log('TOTAL_REPORTS:', stats.total_reports);

        return {
            epaTrend: epaTrendData,
            complexityVsEpa: complexityVsEpaData,
            procedureSpecific: procedureSpecificData
        };
    }, [displayProcedures, filteredProcedures, timeframe, stats, user, procSortAsc]);

    // procedure counts (monthly or annual) computed from all procedures and filtered by selectedProcedure
    const procedureCounts = useMemo(() => {
        const src = procedures || [];
        const filtered = countsSelectedProcedure && countsSelectedProcedure !== 'all'
            ? src.filter(p => {
                const key = (p.proc_code && String(p.proc_code).trim()) || (p.proc_desc && String(p.proc_desc).trim()) || 'Unknown';
                return key === countsSelectedProcedure;
            })
            : src;

        const now = new Date();
        if (countsGranularity === 'monthly') {
            // last 12 months keys YYYY-MM and display labels like 'October 2025'
            const keys: string[] = [];
            const displayLabels: string[] = [];
            for (let i = 11; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                keys.push(key);
                displayLabels.push(d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
            }
            const counts = keys.map(() => 0);
            const mapIndex: Record<string, number> = {};
            keys.forEach((k, idx) => mapIndex[k] = idx);
            filtered.forEach(p => {
                const d = new Date(parseDate(p.create_date));
                if (isNaN(d.getTime())) return;
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                if (mapIndex[key] !== undefined) counts[mapIndex[key]] += 1;
            });
            return { labels: keys, counts, displayLabels };
        } else {
            // annual: last 5 years (display label same as key)
            const labels: string[] = [];
            const displayLabels: string[] = [];
            const years = 5;
            for (let i = years - 1; i >= 0; i--) {
                const y = now.getFullYear() - i;
                labels.push(String(y));
                displayLabels.push(String(y));
            }
            const counts = labels.map(() => 0);
            const mapIndex: Record<string, number> = {};
            labels.forEach((l, idx) => mapIndex[l] = idx);
            filtered.forEach(p => {
                const d = new Date(parseDate(p.create_date));
                if (isNaN(d.getTime())) return;
                const key = String(d.getFullYear());
                if (mapIndex[key] !== undefined) counts[mapIndex[key]] += 1;
            });
            return { labels, counts, displayLabels };
        }
    }, [procedures, countsSelectedProcedure, countsGranularity]);

    const adjustedEpaByReportId = useMemo(() => {
        const map: Record<number, ReturnType<typeof computeAdjustedEPA> | null> = {};
        // ── TEMP DEBUG: top-level state check ──
        console.log('=== adjustedEpaByReportId recompute ===');
        console.log('procedures count:', procedures.length);
        console.log('evaluatorStats keys:', Object.keys(evaluatorStats));
        console.log('evaluatorStats sample:', Object.entries(evaluatorStats).slice(0, 3));
        console.log('procedureMedians keys (first 5):', Object.keys(procedureMedians).slice(0, 5));
        console.log('raw evaluatorStats object:', evaluatorStats);
        // ── END DEBUG ──

        for (const proc of procedures) {
            const procKey = proc.proc_code?.trim().toLowerCase() ?? '';
            const procData = procedureMedians[procKey];

            // Build the evaluators array from all attending user_ids on this report.
            // Attendings with no stats (new/excluded) are filtered out — the lib
            // handles an empty array by returning evaluatorAdjustment = 0.
            const evaluators = (proc.attending_user_ids ?? [])
                .map(id => {
                    const stats = evaluatorStats[Number(id)];
                    if (!stats) return null;
                    return { userId: Number(id), mean: stats.mean, stdDev: stats.stdDev };
                })
                .filter((e): e is { userId: number; mean: number; stdDev: number } => e !== null);

            // Skip entirely if there's no raw score to adjust
            if (!proc.oepa || Number(proc.oepa) <= 0) {
                map[proc.report_id] = null;
                continue;
            }

            const result = computeAdjustedEPA({
                rawScore: proc.oepa,
                procedureDifficulty: ((procData?.complexity ?? 1) as 1 | 2 | 3 | 4 | 5),
                tCase: proc.fluoroscopy_time_minutes ?? null,
                tMedianP: procData?.fluoroTimeMedian ?? null,
                dCase: proc.fluoroscopy_dose_value ?? null,
                dMedianP: procData?.radiationDoseMedian ?? null,
                evaluators,
            });

            map[proc.report_id] = result;
        }

        return map;
    }, [procedures, evaluatorStats, procedureMedians]);

    // dynamic EPA chart options adjusted based on selected timeframe
    const epaOptions = useMemo(() => {
        const base: any = JSON.parse(JSON.stringify(epaTrendOptions));
        let maxTicksLimit = 12;
        if (timeframe === 'last_month') maxTicksLimit = 10;
        else if (timeframe === 'last_6_months') maxTicksLimit = 8;
        else if (timeframe === 'last_year') maxTicksLimit = 6;

        base.scales = base.scales || {};
        base.scales.x = {
            ...(base.scales.x || {}),
            ticks: {
                ...(base.scales.x?.ticks || {}),
                autoSkip: true,
                maxTicksLimit,
                maxRotation: 45,
                minRotation: 0,
            }
        };
        base.scales.y = {
            ...(base.scales.y || {}),
            afterBuildTicks: (axis: any) => {
                axis.ticks = axis.ticks.filter((t: any) => t.value <= 5);
            },
        };
        base.interaction = {
            mode: 'index',
            intersect: false,
            axis: 'x'
        };

        // Re-attach the original plugins including tooltip callbacks (lost in JSON clone)
        base.plugins = {
            ...(epaTrendOptions as any).plugins,
            hoverSlopeLine: {},
        };

        return base as any;
    }, [timeframe]);


    const renderChart = () => {
        if (loading) {
            return (
                <div style={{
                    height: 280,
                    background: 'linear-gradient(90deg, #f8f9fa 0%, #e9ecef 100%)',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#666',
                    fontSize: 16,
                    border: '2px dashed #dee2e6',
                }}>
                    Loading chart data...
                </div>
            );
        }

        if (!chartData) {
            return (
                <div style={{
                    height: 280,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#6b7280',
                    fontSize: 16,
                }}>
                    No data to display for the selected timeframe
                </div>
            );
        }

        if (activeTab === 'EPA Trend' && chartData?.epaTrend) {
            const hasAnyData = chartData.epaTrend.datasets[0]?.data.some((v: null) => v !== null && Number(v) > 0);
            if (!hasAnyData) {
                return (
                <div style={{
                    height: 280,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#9ca3af',
                    gap: 8,
                }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 4-6" strokeDasharray="4 2"/>
                    </svg>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>No EPA scores recorded yet</div>
                    <div style={{ fontSize: 13 }}>Scores will appear here once an attending submits feedback</div>
                </div>
                );
            }
        }

        switch (activeTab) {
            case 'EPA Trend':
                return (
                    <div style={{ height: 280 }}>
                        <Line data={chartData.epaTrend} options={epaOptions} />
                    </div>
                );
            /* Complexity vs EPA tab hidden for now - component retained for future use */
            case 'Procedure-Specific EPA': {
                const barCount = chartData.procedureSpecific.labels?.length ?? 0;
                const chartWidth = Math.max(barCount * 90, 600);
                const containerWidth = chartInnerWidth || 600;
                return (
                    <div style={{ 
                        width: containerWidth, 
                        maxWidth: containerWidth,
                        overflowX: 'auto', 
                        overflowY: 'hidden' 
                    }}>
                        <div style={{ position: 'relative', width: chartWidth, height: 400 }}>
                            <Bar
                                data={chartData.procedureSpecific}
                                options={procedureSpecificOptions}
                            />
                        </div>
                    </div>
                );
            }
            case 'Procedure Counts':
                const firstDataIndex = procedureCounts.counts.findIndex(count => (count || 0) > 0);
                const visibleLabels = firstDataIndex === -1 ? procedureCounts.labels : procedureCounts.labels.slice(firstDataIndex);
                const visibleCounts = firstDataIndex === -1 ? procedureCounts.counts : procedureCounts.counts.slice(firstDataIndex);

                return (
                    <div style={{ background: '#fff', padding: 16, borderRadius: 8 }}>
                        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid rgba(175,213,240,0.2)', borderRadius: 6, background: 'rgba(175,213,240,0.02)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', color: '#0f172a' }}>
                                <thead style={{ background: 'rgba(175,213,240,0.08)', color: '#0f172a' }}>
                                    <tr>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid rgba(175,213,240,0.2)', color: '#0f172a', fontWeight: 700 }}>{countsGranularity === 'monthly' ? 'Month' : 'Year'}</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid rgba(175,213,240,0.2)', color: '#0f172a', fontWeight: 700 }}>Count</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleLabels.map((lbl, idx) => {
                                        const originalIdx = firstDataIndex === -1 ? idx : firstDataIndex + idx;
                                        const display = (procedureCounts as any).displayLabels?.[originalIdx] ?? lbl;
                                        return (
                                            <tr key={lbl} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '8px 12px' }}>{display}</td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>{visibleCounts[idx] || 0}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div
            style={{
            minHeight: '100vh',
                width: '100%',
                background: 'linear-gradient(135deg, #c8ceee 40%, #a7abde 100%)',
                fontFamily: 'Ubuntu, sans-serif',
                padding: 20,
                boxSizing: 'border-box',
            }}
        >
            <div style={{
                maxWidth: '100%',
                margin: '0 auto',
            }}>
                {/* Header */}
                <div style={{
                    background: '#fff',
                    borderRadius: 16,
                    padding: 24,
                    marginBottom: 20,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                }}>
                    <div>
                        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8, color: '#000', margin: '0 0 8px 0' }}>
                            EPA Progress Dashboard
                        </h1>
                        <div style={{ color: '#666', fontSize: 16 }}>
                            {user ? (
                                <>
                                    {/* Display for trainee-focused dashboard */}
                                    <strong>Trainee:</strong>
                                    {/* Prefer the preferred_name when non-empty, otherwise fall back to first + last */}
                                    <span>{` ${((user as any)?.preferred_name && String((user as any).preferred_name).trim()) ? String((user as any).preferred_name).trim() : user.first_name} ${user.last_name}`}</span>
                                    <span>{' | '}</span>
                                    <strong>PGY:</strong>
                                    <span>{` ${(user as any)?.pgy != null ? (user as any).pgy : ''}`}</span>
                                    <span>{' | '}</span>
                                    <strong>Specialty:</strong>
                                    <span>{` ${user.specialty ?? 'Interventional Radiology'}`}</span>
                                </>
                            ) : (
                                'Loading user info...'
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <DashboardToggle />
                        </div>

                        <button
                            onClick={openProfileModal}
                            style={{
                                background: '#fff',
                                color: '#374151',
                                border: '1px solid rgba(55,65,81,0.08)',
                                borderRadius: 8,
                                padding: '10px 18px',
                                fontSize: 14,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.12s ease',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                            }}
                            title="Edit your account"
                            onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 8px rgba(0,0,0,0.08)';
                            }}
                            onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)';
                            }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                            </svg>
                            Edit Profile
                        </button>

                        {/* Logout Button */}
                        <button
                            onClick={() => router.push('/')}
                            style={{
                                background: 'linear-gradient(135deg, #ff6b6b, #ee5a52)',
                                color: '#fff',
                                border: '1px solid rgba(55,65,81,0.08)',
                                borderRadius: 8,
                                padding: '10px 18px',
                                fontSize: 14,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.12s ease',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                flexShrink: 0,
                            }}
                            onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 8px rgba(238, 90, 82, 0.4)';
                            }}
                            onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)';
                            }}
                            title="Sign out of your account"
                        >
                            <svg 
                                width="16" 
                                height="16" 
                                viewBox="0 0 24 24" 
                                fill="none" 
                                stroke="currentColor" 
                                strokeWidth="2" 
                                strokeLinecap="round" 
                                strokeLinejoin="round"
                            >
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                                <polyline points="16,17 21,12 16,7"/>
                                <line x1="21" y1="12" x2="9" y2="12"/>
                            </svg>
                            Logout
                        </button>
                    </div>
                </div>

                
                {/* Main Content: Two Column Layout */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr',
                    gap: 20,
                }}>                    
                    {/* Left Column: Charts and Tables with Layered Tabs */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        {/* Overview Widgets */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr 1fr',
                            gap: 20,
                            marginBottom: 20,
                        }}>
                            {/* EPA Score Widget */}
                            <div style={{
                                background: '#fff',
                                borderRadius: 12,
                                padding: 24,
                                textAlign: 'center',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                            }}>
                                <div style={{ fontSize: 48, color: '#afd5f0', fontWeight: 700, marginBottom: 8 }}>
                                    {loading
                                        ? '...'
                                        : typeof stats.avg_epa === 'number' && stats.avg_epa > 0
                                        ? stats.avg_epa.toFixed(2)
                                        : <span style={{ fontSize: 32, color: '#9ca3af' }}>N/A</span>}
                                </div>
                                <div style={{ fontSize: 12, color: '#000', fontWeight: 600, textTransform: 'uppercase' }}>
                                    Current Adjusted EPA<br />Average
                                </div>
                            </div>

                            {/* Procedures This Month Widget */}
                            <div style={{
                                background: '#fff',
                                borderRadius: 12,
                                padding: 24,
                                textAlign: 'center',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                            }}>
                                <div style={{ fontSize: 48, color: '#b2d3c2', fontWeight: 700, marginBottom: 8 }}>
                                    {loading ? '...' : stats.procedures}
                                </div>
                                <div style={{ fontSize: 12, color: '#000', fontWeight: 600, textTransform: 'uppercase' }}>
                                    Procedures This Month
                                </div>
                            </div>

                            {/* Pending Feedback Widget */}
                            <div style={{
                                background: '#fff',
                                borderRadius: 12,
                                padding: 24,
                                textAlign: 'center',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                            }}>
                                <div style={{ fontSize: 48, color: 'rgba(255, 126, 112, 0.7)', fontWeight: 700, marginBottom: 8 }}>
                                    {loading ? '...' : stats.feedback_requested}
                                </div>
                                <div style={{ fontSize: 12, color: '#000', fontWeight: 600, textTransform: 'uppercase' }}>
                                    Pending Feedback
                                </div>
                            </div>
                        </div>
                        
                        {/* Chart Container with Layered Tabs */}
                        <div style={{
                            position: 'relative',
                        }}>
                            {/* Chart Container */}
                            <div ref={chartContainerRef} style={{
                                background: '#fff',
                                borderRadius: 12,
                                padding: 24,
                                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                                position: 'relative',
                                zIndex: 5,
                                marginTop: 32,
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                    <div style={{ fontWeight: 700, fontSize: 18, color: '#000' }}>{activeTab}</div>
                                    {/* Timeframe filter for EPA Trend chart */}
                                    {activeTab === 'EPA Trend' && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <label htmlFor="procedure-select" style={{ fontSize: 13, color: '#000000ff', fontWeight: 600 }}>Procedure</label>
                                                <div style={{ position: 'relative', display: 'inline-block' }}>
                                                    <select
                                                        id="procedure-select"
                                                        value={selectedProcedure}
                                                        onChange={(e) => setSelectedProcedure(e.target.value)}
                                                        style={{
                                                            padding: '6px 34px 6px 10px',
                                                            borderRadius: 8,
                                                            border: '1px solid rgba(0, 0, 0, 0.3)',
                                                            background: 'rgba(175,213,240,0.06)',
                                                            fontWeight: 600,
                                                            cursor: 'pointer',
                                                            color: 'rgba(0, 0, 0, 0.6)',
                                                            fontSize: 13,
                                                            WebkitAppearance: 'none',
                                                            MozAppearance: 'none',
                                                            appearance: 'none'
                                                        }}
                                                    >
                                                        <option value="all">All procedures</option>
                                                        {procedureOptions.map(opt => (
                                                            <option key={opt.key} value={opt.key}>{opt.label}</option>
                                                        ))}
                                                    </select>
                                                    <svg viewBox="0 0 24 24" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, pointerEvents: 'none', color: 'rgba(74,144,226,1)' }} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                        <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <label htmlFor="timeframe-select" style={{ fontSize: 13, color: '#000000ff', fontWeight: 600 }}>Timeframe</label>
                                                <div style={{ position: 'relative', display: 'inline-block' }}>
                                                    <select
                                                        id="timeframe-select"
                                                        value={timeframe}
                                                        onChange={(e) => setTimeframe(e.target.value as 'last_month' | 'last_6_months' | 'last_year' | 'all')}
                                                        style={{
                                                            padding: '6px 34px 6px 10px',
                                                            borderRadius: 8,
                                                            border: '1px solid rgba(0, 0, 0, 0.3)',
                                                            background: 'rgba(175,213,240,0.06)',
                                                            fontWeight: 600,
                                                            cursor: 'pointer',
                                                            color: 'rgba(0, 0, 0, 0.6)',
                                                            fontSize: 13,
                                                            WebkitAppearance: 'none',
                                                            MozAppearance: 'none',
                                                            appearance: 'none'
                                                        }}
                                                    >
                                                        <option value="last_month">Last month</option>
                                                        <option value="last_6_months">Last 6 months</option>
                                                        <option value="last_year">Last year</option>
                                                        <option value="all">All</option>
                                                    </select>
                                                    <svg viewBox="0 0 24 24" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, pointerEvents: 'none', color: 'rgba(74,144,226,1)' }} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                        <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {activeTab === 'Procedure-Specific EPA' && (
                                        <button
                                            onClick={() => setProcSortAsc(prev => !prev)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                padding: '6px 12px',
                                                borderRadius: 8,
                                                border: '1px solid rgba(0, 0, 0, 0.3)',
                                                background: 'rgba(175,213,240,0.06)',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                color: 'rgba(0, 0, 0, 0.6)',
                                                fontSize: 13,
                                            }}
                                        >
                                            {procSortAsc ? (
                                                <>
                                                    Low → High
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
                                                    </svg>
                                                </>
                                            ) : (
                                                <>
                                                    High → Low
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
                                                    </svg>
                                                </>
                                            )}
                                        </button>
                                    )}

                                    {activeTab === 'Procedure Counts' && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <label htmlFor="proc-counts-procedure-select" style={{ fontSize: 13, color: '#000000ff', fontWeight: 600 }}>Procedure</label>
                                                <div style={{ position: 'relative', display: 'inline-block' }}>
                                                    <select
                                                        id="proc-counts-procedure-select"
                                                        value={countsSelectedProcedure}
                                                        onChange={(e) => setCountsSelectedProcedure(e.target.value)}
                                                        style={{
                                                            padding: '6px 34px 6px 10px',
                                                            borderRadius: 8,
                                                            border: '1px solid rgba(0, 0, 0, 0.3)',
                                                            background: 'rgba(175,213,240,0.06)',
                                                            fontWeight: 600,
                                                            cursor: 'pointer',
                                                            color: 'rgba(0, 0, 0, 0.6)',
                                                            fontSize: 13,
                                                            WebkitAppearance: 'none',
                                                            MozAppearance: 'none',
                                                            appearance: 'none'
                                                        }}
                                                    >
                                                        <option value="all">All procedures</option>
                                                        {procedureOptions.map(opt => (
                                                            <option key={opt.key} value={opt.key}>{opt.label}</option>
                                                        ))}
                                                    </select>
                                                    <svg viewBox="0 0 24 24" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, pointerEvents: 'none', color: 'rgba(74,144,226,1)' }} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                        <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <label htmlFor="counts-timeframe-select" style={{ fontSize: 13, color: '#000000ff', fontWeight: 600 }}>Timeframe</label>
                                                <div style={{ position: 'relative', display: 'inline-block' }}>
                                                    <select
                                                        id="counts-timeframe-select"
                                                        value={countsGranularity}
                                                        onChange={(e) => setCountsGranularity(e.target.value as 'monthly' | 'annual')}
                                                        style={{
                                                            padding: '6px 34px 6px 10px',
                                                            borderRadius: 8,
                                                            border: '1px solid rgba(0, 0, 0, 0.3)',
                                                            background: 'rgba(175,213,240,0.06)',
                                                            fontWeight: 600,
                                                            cursor: 'pointer',
                                                            color: 'rgba(0, 0, 0, 0.6)',
                                                            fontSize: 13,
                                                            WebkitAppearance: 'none',
                                                            MozAppearance: 'none',
                                                            appearance: 'none'
                                                        }}
                                                    >
                                                        <option value="monthly">Monthly</option>
                                                        <option value="annual">Annual</option>
                                                    </select>
                                                    <svg viewBox="0 0 24 24" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, pointerEvents: 'none', color: 'rgba(74,144,226,1)' }} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                                        <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                {renderChart()}
                            </div>

                            {/* Layered Tab Navigation Behind Chart */}
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: chartInnerLeft,
                                // keep the tab row left-bound: allow its width to be determined
                                // by the tab buttons and prevent automatic centering
                                width: 'auto',
                                maxWidth: chartInnerWidth,
                                display: 'flex',
                                justifyContent: 'flex-start',
                                marginLeft: 0,
                                zIndex: 1, // Behind chart container
                            }}>
                                {tabs.map((tab, index) => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        style={{
                                            background: activeTab === tab ? '#6b7280' : '#e5e7fa',
                                            color: activeTab === tab ? '#ffffffff' : '#000000',
                                            width: index === tabs.length - 1 ? lastTabWidth : baseTabWidth,
                                            height: 40,
                                            border: '1px solid rgba(107, 114, 128, 0.5)',
                                            borderRadius: '8px 8px 0 0', // Only top corners rounded
                                            fontWeight: 600,
                                            fontSize: 14,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease',
                                            position: 'relative',
                                            zIndex: 3 - index, // Active tab highest among tabs, others decrease
                                            marginLeft: index > 0 ? `-${tabOverlap}px` : '0', // Negative margin for overlap
                                            boxShadow: activeTab === tab
                                                ? '0 -2px 8px rgba(0,0,0,0.15)'
                                                : '0 -1px 4px rgba(0,0,0,0.08)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            boxSizing: 'border-box',
                                            overflow: 'hidden',
                                            whiteSpace: 'nowrap',
                                            textOverflow: 'ellipsis'
                                        }}
                                    >
                                        {tab}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Procedure Summary Table - Full Width */}
                        <div style={{
                            background: '#fff',
                            borderRadius: 12,
                            padding: 24,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        }}>
                            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 16, color: '#000' }}>
                                Procedure Log
                            </div>
                            <div style={{ 
                                maxHeight: 500, 
                                overflowY: 'auto',
                                border: '1px solid #e9ecef',
                                borderRadius: 6,
                                fontSize: 13,
                            }}>
                                <ProcedureLogTable
                                    procedures={procedures}
                                    adjustedEpaByReportId={adjustedEpaByReportId}
                                    adjustedStatsLoading={adjustedStatsLoading}
                                    loading={loading}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Progress Circle and Recent Feedback */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'stretch' }}>
                        {/* Report Progress Circle */}
                        <ReportProgressCircle
                            completed={stats.total_reports}
                            total={1000}
                            loading={loading}
                        />

                        {/* Key Performance Metrics (replaces recent feedback on trainee dashboard) */}
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                            <KeyPerformanceMetrics procedures={procedures} loading={loading} />
                        </div>

                        {/* Seek Feedback Rate Trends component removed from trainee dashboard (component retained) */}
                    </div>
                </div>
                {/* Profile Edit Modal */}
                {showProfileModal && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                        <div style={{ width: 520, background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,0.3)', maxWidth: '95%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#374151' }}>Edit Profile</h3>
                                <button onClick={closeProfileModal} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }} title="Close">×</button>
                            </div>

                            <form onSubmit={submitProfileUpdate}>
                                <div style={{ display: 'grid', gap: 12 }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                        <label style={{ fontSize: 13, color: '#333' }}>
                                            First name
                                            <input
                                                value={profileForm.first_name}
                                                onChange={(e) => setProfileForm(prev => ({ ...prev, first_name: e.target.value }))}
                                                style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                                                placeholder="First name"
                                            />
                                        </label>

                                        <label style={{ fontSize: 13, color: '#333' }}>
                                            Last name
                                            <input
                                                value={profileForm.last_name}
                                                onChange={(e) => setProfileForm(prev => ({ ...prev, last_name: e.target.value }))}
                                                style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                                                placeholder="Last name"
                                            />
                                        </label>
                                    </div>

                                    <label style={{ fontSize: 13, color: '#333' }}>
                                        Username
                                        <input
                                            value={profileForm.username}
                                            onChange={(e) => setProfileForm(prev => ({ ...prev, username: e.target.value }))}
                                            style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                                            placeholder="username"
                                        />
                                    </label>

                                    <label style={{ fontSize: 13, color: '#333' }}>
                                        New password
                                        <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 6 }}>(leave blank to keep current)</span>
                                        <input
                                            type="password"
                                            value={profileForm.password}
                                            onChange={(e) => setProfileForm(prev => ({ ...prev, password: e.target.value }))}
                                            style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                                            placeholder="new password"
                                        />
                                    </label>

                                    <label style={{ fontSize: 13, color: '#333' }}>
                                        Confirm new password
                                        <input
                                            type="password"
                                            value={profileForm.confirm_password}
                                            onChange={(e) => setProfileForm(prev => ({ ...prev, confirm_password: e.target.value }))}
                                            style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                                            placeholder="confirm new password"
                                        />
                                    </label>

                                    {/* Role and PGY are only shown to attending users (this page is for trainees) */}
                                    {((user as any)?.role === 'attending') && (
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                            <label style={{ fontSize: 13, color: '#333' }}>
                                                Role
                                                <input
                                                    value={profileForm.role}
                                                    onChange={(e) => setProfileForm(prev => ({ ...prev, role: e.target.value }))}
                                                    style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                                                    placeholder="role"
                                                />
                                            </label>

                                            <label style={{ fontSize: 13, color: '#333' }}>
                                                PGY
                                                <input
                                                    value={profileForm.pgy}
                                                    onChange={(e) => setProfileForm(prev => ({ ...prev, pgy: e.target.value }))}
                                                    style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                                                    placeholder="PGY (numeric)"
                                                    inputMode="numeric"
                                                />
                                            </label>
                                        </div>
                                    )}

                                    <label style={{ fontSize: 13, color: '#333' }}>
                                        Preferred / display name
                                        <input
                                            value={profileForm.preferred_name}
                                            onChange={(e) => setProfileForm(prev => ({ ...prev, preferred_name: e.target.value }))}
                                            style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                                            placeholder="Preferred name"
                                        />
                                    </label>

                                    {profileError && <div style={{ color: '#b91c1c', fontSize: 13 }}>{profileError}</div>}
                                    {profileSuccess && <div style={{ color: '#166534', fontSize: 13 }}>{profileSuccess}</div>}

                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                                        <button type="button" onClick={closeProfileModal} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e6e6e6', background: '#fff', cursor: 'pointer' }}>Cancel</button>
                                        <button type="submit" disabled={profileLoading} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff', cursor: 'pointer' }}>{profileLoading ? 'Saving...' : 'Save'}</button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
