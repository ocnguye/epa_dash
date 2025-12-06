'use client';

/* Imports */
import React, { useEffect, useMemo, useState, useRef } from 'react';
import  ProgressCircle from "@/components/ProgressCircle";
import SeekFeedbackChart from "@/components/SeekFeedbackChart";
import KeyPerformanceMetrics from "@/components/KeyPerformanceMetrics";
import { 
    epaTrendOptions, 
    complexityVsEpaOptions, 
    procedureSpecificOptions 
} from "@/components/ChartConfigs";
import { Line, Bar, Scatter } from 'react-chartjs-2';
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
    ChartOptions 
} from 'chart.js';
import { useRouter } from 'next/navigation';

ChartJS.register(
    CategoryScale, 
    LinearScale, 
    PointElement, 
    LineElement, 
    BarElement,
    Title, 
    Tooltip, 
    Legend
);

/* Types */
type User = {
    first_name: string;
    last_name: string;
    role: string;
    specialty: string | null;
    rotation: string | null;
};

type Procedure = {
    report_id: number;
    create_date: string;
    proc_desc: string;
    proc_code?: string; // ProcedureCodeList from the reports table
    seek_feedback: 'not_required' | 'feedback_requested' | 'discussed';
    complexity: number;
    oepa: number;
    trainee_name: string;
    attending_name: string;
};

type Stats = {
    avg_epa: number;
    procedures: number;
    feedback_requested: number;
    total_procedures: number;
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

// helper function to describe scores
const getEPADescription = (score: number) => {
    switch(score) {
        case 1: return "1 – Not allowed to practice procedure/task.";
        case 2: return "2 – Allowed to practice procedure/task only under proactive, full supervision.";
        case 3: return "3 – Allowed to practice procedure/task only under assisted direct supervision.";
        case 4: return "4 – Allowed to practice procedure/task without direct supervision.";
        case 5: return "5 – Allowed to supervise others in practice of procedure/task.";
        default: return "Trainee was not observed by an attending in this capacity.";
    }
};

// helper function to describe complexity
const getComplexityDescription = (complexity: number) => {
    switch(complexity) {
        case 1: return "1 - Straightforward";
        case 2: return "2 - Mildly Complex";
        case 3: return "3 - Moderately Complex";
        case 4: return "4 - Very Complex";
        default: return "Unavailable";
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
    });
    const [procedures, setProcedures] = useState<Procedure[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState('EPA TREND');
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
    const tabs = ['EPA TREND', 'COMPLEXITY VS EPA', 'PROCEDURE-SPECIFIC EPA', 'PROCEDURE COUNTS'];
    const tabOverlap = 12; // pixels of overlap between adjacent tabs

    useEffect(() => {
        const el = chartContainerRef.current;
        if (!el || typeof ResizeObserver === 'undefined') {
            if (el) setChartContainerWidth(el.clientWidth || 0);
            return;
        }
        // observe size changes
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                const w = entry.contentRect.width;
                setChartContainerWidth(Math.floor(w));
            }
        });
        ro.observe(el);
        // initial
        setChartContainerWidth(el.clientWidth || 0);
        return () => ro.disconnect();
    }, [chartContainerRef]);

    const computedTabWidth = (() => {
        const count = tabs.length;
        if (!count || !chartContainerWidth) return 200;
        const totalVisible = chartContainerWidth + tabOverlap * (count - 1);
        return Math.max(100, Math.floor(totalVisible / count));
    })();
    // Profile modal state
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [profileForm, setProfileForm] = useState({ username: '', password: '', confirm_password: '', preferred_name: '', first_name: '', last_name: '', role: '', pgy: '' });
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [profileSuccess, setProfileSuccess] = useState('');

    // Function to fetch dashboard data
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
        } catch (err: any) {
            setError(err.message || 'Error loading dashboard');
        }
        setLoading(false);
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
    }, []);

    const feedbackRate = stats.total_procedures ? (stats.feedback_requested / stats.total_procedures) * 100 : 0;

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
            const d = new Date(p.create_date);
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
    const sortedProcedures = [...displayProcedures].sort((a, b) => new Date(a.create_date).getTime() - new Date(b.create_date).getTime());

        // Helper formatters
        const fmtDay = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD
        const dayLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
        const monthLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

        let epaLabels: string[] = [];
        let epaData: Array<number | null> = [];

        if (timeframe === 'all') {
            epaLabels = sortedProcedures.map(proc => {
                const date = new Date(proc.create_date);
                return dayLabel(date);
            });
            epaData = sortedProcedures.map(proc => proc.oepa);
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
                    const k = fmtDay(new Date(p.create_date));
                    if (!map[k]) map[k] = { sum: 0, count: 0 };
                    const v = Number(p.oepa);
                    if (Number.isFinite(v)) { map[k].sum += v; map[k].count += 1; }
                });
                epaLabels = buckets.map(d => {
                    const parts = d.split('-');
                    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                    return dayLabel(date);
                });
                epaData = buckets.map(k => map[k] && map[k].count ? Number((map[k].sum / map[k].count).toFixed(2)) : null);
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
                    const date = new Date(p.create_date);
                    const k = monthKey(date);
                    if (!map[k]) map[k] = { sum: 0, count: 0 };
                    const v = Number(p.oepa);
                    if (Number.isFinite(v)) { map[k].sum += v; map[k].count += 1; }
                });
                epaLabels = buckets.map(k => {
                    const [y, m] = k.split('-');
                    const d = new Date(Number(y), Number(m) - 1, 1);
                    return monthLabel(d);
                });
                epaData = buckets.map(k => map[k] && map[k].count ? Number((map[k].sum / map[k].count).toFixed(2)) : null);
            }
        }

        const cohortAvg = (typeof (stats as any)?.cohort_avg_epa === 'number') ? (stats as any).cohort_avg_epa : 0;

        const epaDatasets: any[] = [];
        epaDatasets.push({
            label: 'EPA Score',
            data: epaData,
            borderColor: '#afd5f0',
            backgroundColor: 'rgba(74, 144, 226, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#afd5f0',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 6,
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
                tension: 0.2,
                borderDash: [6, 4],
                // remove visible points on the cohort line but keep a generous hover/hit area
                pointRadius: 0,
                pointHoverRadius: 10,
                pointHitRadius: 10,
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
                    data: filteredProcedures.map(proc => ({ x: proc.complexity, y: proc.oepa })),
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
                // keep a representative description for the procedure code (first seen)
                acc[key] = { total: 0, sum: 0, count: 0, desc: proc.proc_desc } as any;
            }
            // coerce oepa to a number and only include valid numeric EPAs in the average
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

        const labels = Object.keys(procTypeStats);
        const descriptions = Object.values(procTypeStats).map(stat => stat.desc || '');
        const counts = Object.values(procTypeStats).map(stat => stat.count || 0);

        const procedureSpecificData = {
            labels,
            datasets: [
                {
                    label: 'Average EPA Score',
                    data: Object.values(procTypeStats).map(stat => Number(stat.total.toFixed(1))),
                    // attach descriptions and counts for tooltip callbacks
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

        return {
            epaTrend: epaTrendData,
            complexityVsEpa: complexityVsEpaData,
            procedureSpecific: procedureSpecificData
        };
    }, [displayProcedures, filteredProcedures, timeframe, stats, user]);

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
                const d = new Date(p.create_date);
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
                const d = new Date(p.create_date);
                if (isNaN(d.getTime())) return;
                const key = String(d.getFullYear());
                if (mapIndex[key] !== undefined) counts[mapIndex[key]] += 1;
            });
            return { labels, counts, displayLabels };
        }
    }, [procedures, countsSelectedProcedure, countsGranularity]);

    // dynamic EPA chart options adjusted based on selected timeframe
    const epaOptions = useMemo(() => {
        // clone base options to avoid mutating imported config
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

        // For longer time windows, shorten label text where possible by keeping month and day only
        base.plugins = base.plugins || {};
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

        switch (activeTab) {
            case 'EPA TREND':
                return (
                    <div style={{ height: 280 }}>
                        <Line data={chartData.epaTrend} options={epaOptions} />
                    </div>
                );
            case 'COMPLEXITY VS EPA':
                return (
                    <div style={{ height: 280 }}>
                        <Scatter data={chartData.complexityVsEpa} options={complexityVsEpaOptions} />
                    </div>
                );
            case 'PROCEDURE-SPECIFIC EPA':
                return (
                    <div style={{ height: 280 }}>
                        <Bar data={chartData.procedureSpecific} options={procedureSpecificOptions} />
                    </div>
                );
            case 'PROCEDURE COUNTS':
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
                                    {procedureCounts.labels.map((lbl, idx) => {
                                        const display = (procedureCounts as any).displayLabels && (procedureCounts as any).displayLabels[idx]
                                            ? (procedureCounts as any).displayLabels[idx]
                                            : lbl;
                                        return (
                                            <tr key={lbl} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '8px 12px' }}>{display}</td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>{procedureCounts.counts[idx] || 0}</td>
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
                width: '100vw',
                background: 'linear-gradient(135deg, #c8ceee 40%, #a7abde 100%)',
                fontFamily: 'Ubuntu, sans-serif',
                padding: 20,
                boxSizing: 'border-box',
            }}
        >
            <div style={{
                maxWidth: 'calc(100vw - 40px)',
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
                                        : typeof stats.avg_epa === 'number' && !isNaN(stats.avg_epa)
                                            ? stats.avg_epa.toFixed(1)
                                            : '0.0'}
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
                                    {activeTab === 'EPA TREND' && (
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

                                    {activeTab === 'PROCEDURE COUNTS' && (
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
                                left: 0,
                                display: 'flex',
                                zIndex: 1, // Behind chart container
                            }}>
                                {tabs.map((tab, index) => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        style={{
                                            background: activeTab === tab ? '#6b7280' : '#e5e7fa',
                                            color: activeTab === tab ? '#ffffffff' : '#000000',
                                            width: computedTabWidth,
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
                                Procedure Summary
                            </div>
                            <div style={{ 
                                maxHeight: 500, 
                                overflowY: 'auto',
                                border: '1px solid #e9ecef',
                                borderRadius: 6,
                                fontSize: 13,
                            }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', color: '#0f172a' }}>
                                    <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 20, boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
                                        <tr>
                                            <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>Date</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}><strong>Trainee</strong></th>
                                            <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>Procedure Code</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>Description</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'center', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>Status</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'center', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>Complexity</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'center', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>EPA</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {loading ? (
                                            <tr>
                                                <td colSpan={7} style={{ textAlign: 'center', color: '#888', padding: '20px' }}>Loading...</td>
                                            </tr>
                                        ) : (
                                            procedures.map((proc) => (
                                                <tr key={proc.report_id} style={{ borderBottom: '1px solid #f8f9fa' }}>
                                                    <td style={{ padding: '8px 12px', color: '#000' }}>{proc.create_date}</td>
                                                    <td style={{ padding: '8px 12px', color: '#000' }}>
                                                        <div style={{ fontWeight: 600 }}>{proc.trainee_name}</div>
                                                        <div style={{ fontSize: 12, color: '#666' }}>{proc.attending_name}</div>
                                                    </td>
                                                    <td style={{ padding: '8px 12px', color: '#000' }}>{truncateText(proc.proc_desc || proc.proc_code)}</td>
                                                    <td style={{ padding: '8px 12px', color: '#000' }}>{proc.proc_desc}</td>
                                                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                                        {(() => {
                                                            const status = getFeedbackStatus(proc.seek_feedback);
                                                            return (
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                                                    {/* Status badge rendered as a compact select so status display and control are the same element */}
                                                                    <div style={{ position: 'relative', display: 'inline-block', width: 140 }}>
                                                                        <select
                                                                            value={proc.seek_feedback}
                                                                            onChange={(e) => updateProcedureStatus(proc.report_id, e.target.value)}
                                                                            title={getStatusDescription(proc.seek_feedback)}
                                                                            style={{
                                                                                // badge styling
                                                                                padding: '4px 8px',
                                                                                paddingRight: '30px',
                                                                                borderRadius: 6,
                                                                                fontSize: 11,
                                                                                fontWeight: 600,
                                                                                display: 'inline-block',
                                                                                width: '100%',
                                                                                textAlign: 'center',
                                                                                cursor: 'pointer',
                                                                                border: '1px solid rgba(0,0,0,0.06)',
                                                                                backgroundColor: status.bgColor,
                                                                                color: status.color,
                                                                                WebkitAppearance: 'none',
                                                                                MozAppearance: 'none',
                                                                                appearance: 'none',
                                                                            }}
                                                                        >
                                                                            <option value="not_required">Not Required</option>
                                                                            <option value="feedback_requested">Feedback Requested</option>
                                                                            <option value="discussed">Discussed</option>
                                                                        </select>
                                                                        <svg viewBox="0 0 10 6" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 8, height: 5, pointerEvents: 'none', color: status.color }} xmlns="http://www.w3.org/2000/svg">
                                                                            <path d="M0 0 L5 6 L10 0" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                                                                        </svg>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td style={{ padding: '8px 12px', color: '#000', textAlign: 'center', fontWeight: 600 }}
                                                    title={getComplexityDescription(proc.complexity)}>
                                                        {proc.complexity}</td>
                                                    <td style={{ padding: '8px 12px', color: '#000', textAlign: 'center', fontWeight: 600 }}
                                                    title={getEPADescription(proc.oepa)}>
                                                        {proc.oepa}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Progress Circle and Recent Feedback */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        {/* Large Progress Circle */}
                        <div style={{
                            padding: 24,
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            minHeight: 280,
                        }}>
                            <ProgressCircle
                                // pass raw counts so the circle shows discussed/ requested and computes percentage
                                // provide sensible fallbacks in case the backend omits certain stats
                                requestedCount={typeof stats.feedback_requested === 'number' && stats.feedback_requested >= 0
                                    ? stats.feedback_requested
                                    : procedures.filter(p => p.seek_feedback === 'feedback_requested').length}
                                discussedCount={procedures.filter(p => p.seek_feedback === 'discussed').length}
                                notRequiredCount={procedures.filter(p => p.seek_feedback === 'not_required').length}
                                totalCount={typeof stats.total_procedures === 'number' && stats.total_procedures > 0
                                    ? stats.total_procedures
                                    : (typeof stats.procedures === 'number' && stats.procedures > 0
                                        ? stats.procedures
                                        : procedures.length)}
                                size={275}
                                strokeWidth={18}
                                loading={loading}
                            />
                        </div>

                        {/* Key Performance Metrics (replaces recent feedback on trainee dashboard) */}
                        <div>
                            <KeyPerformanceMetrics procedures={procedures} loading={loading} />
                        </div>

                        {/* Seek Feedback Rate Trends */}
                        <div style={{
                            background: '#fff',
                            borderRadius: 12,
                            padding: 24,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                            flex: 1,
                        }}>
                            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 16, color: '#000' }}>
                                Seek Feedback Rate Trends
                            </div>
                            <SeekFeedbackChart procedures={procedures} loading={loading} height={350} />
                        </div>
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
