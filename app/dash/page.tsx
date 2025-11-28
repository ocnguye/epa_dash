'use client';

/* Imports */
import React, { useEffect, useMemo, useState } from 'react';
import  ProgressCircle from "@/components/ProgressCircle";
import SeekFeedbackChart from "@/components/SeekFeedbackChart";
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
    // Profile modal state
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [profileForm, setProfileForm] = useState({ username: '', password: '', preferred_name: '', first_name: '', last_name: '', role: '', pgy: '' });
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

    const chartData = useMemo(() => {
        if (!procedures.length) return null;

        // EPA Trend Data - chronological order
        const sortedProcedures = [...procedures].sort((a, b) => new Date(a.create_date).getTime() - new Date(b.create_date).getTime());
        const epaTrendData = {
            labels: sortedProcedures.map(proc => {
                const date = new Date(proc.create_date);
                return date.toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric' 
                });
            }),
            datasets: [
                {
                    label: 'EPA Score',
                    data: sortedProcedures.map(proc => proc.oepa),
                    borderColor: '#afd5f0',
                    backgroundColor: 'rgba(74, 144, 226, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#afd5f0',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 6,
                }
            ]
        };


        const complexityVsEpaData = {
            datasets: [
                {
                    label: 'Procedures',
                    data: procedures.map(proc => ({
                        x: proc.complexity, 
                        y: proc.oepa
                    })),
                    backgroundColor: '#afd5f0',
                    borderColor: '#fff',
                    borderWidth: 2,
                    pointRadius: 8,
                    pointHoverRadius: 10,
                }
            ]
        };

        const procTypeStats = procedures.reduce((acc, proc) => {
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
    }, [procedures]);


    const renderChart = () => {
        if (loading || !chartData) {
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

        switch (activeTab) {
            case 'EPA TREND':
                return (
                    <div style={{ height: 280 }}>
                        <Line data={chartData.epaTrend} options={epaTrendOptions} />
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
                                    <span>{` ${((user as any)?.preferred_name && String((user as any).preferred_name).trim()) ? String((user as any).preferred_name).trim() : `${user.first_name} ${user.last_name}`}`}</span>
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
                                border: 'none',
                                borderRadius: 8,
                                padding: '12px 24px',
                                fontSize: 14,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                boxShadow: '0 2px 4px rgba(238, 90, 82, 0.3)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                flexShrink: 0,
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-1px)';
                                e.currentTarget.style.boxShadow = '0 4px 8px rgba(238, 90, 82, 0.4)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 2px 4px rgba(238, 90, 82, 0.3)';
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
                            <div style={{
                                background: '#fff',
                                borderRadius: 12,
                                padding: 24,
                                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                                position: 'relative',
                                zIndex: 5,
                                marginTop: 32,
                            }}>
                                <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 16, color: '#000'}}>
                                    {activeTab}
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
                                {['EPA TREND', 'COMPLEXITY VS EPA', 'PROCEDURE-SPECIFIC EPA'].map((tab, index) => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        style={{
                                            background: activeTab === tab ? '#6b7280' : '#e5e7fa',
                                            color: activeTab === tab ? '#ffffffff' : '#000000',
                                            width: 250,
                                            height: 40,
                                            border: '1px solid rgba(107, 114, 128, 0.5)',
                                            borderRadius: '8px 8px 0 0', // Only top corners rounded
                                            fontWeight: 600,
                                            fontSize: 14,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease',
                                            position: 'relative',
                                            zIndex: 3 - index, // Active tab highest among tabs, others decrease
                                            marginLeft: index > 0 ? '-12px' : '0', // Negative margin for overlap
                                            boxShadow: activeTab === tab
                                                ? '0 -2px 8px rgba(0,0,0,0.15)'
                                                : '0 -1px 4px rgba(0,0,0,0.08)',
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
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                                                    <td style={{ padding: '8px 12px', color: '#000' }}>{proc.proc_code || proc.proc_desc}</td>
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

                        {/* Recent Feedback */}
                        <div style={{
                            background: '#fff',
                            borderRadius: 12,
                            padding: 24,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        }}>
                            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 16, color: '#000' }}>
                                Recent Feedback
                            </div>
                            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                                {loading ? (
                                    <div style={{ color: '#888', textAlign: 'center' }}>Loading...</div>
                                ) : (
                                    procedures.map((proc) => (
                                        <div key={proc.report_id} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
                                            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                                                {(() => {
                                                    const [year, month, day] = proc.create_date.split('-');
                                                    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                                                    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                                                })()}
                                            </div>
                                            <div style={{ fontWeight: 600, color: '#000', fontSize: 14, marginBottom: 4 }}>
                                                {proc.proc_desc}
                                            </div>
                                            {/* Render status text as a select so the badge is also the control */}
                                            <div style={{ position: 'relative', display: 'inline-block', width: 160 }}>
                                                <select
                                                    value={proc.seek_feedback}
                                                    onChange={(e) => updateProcedureStatus(proc.report_id, e.target.value)}
                                                    title={getStatusDescription(proc.seek_feedback)}
                                                    style={{
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
                                                        backgroundColor: getFeedbackStatus(proc.seek_feedback).bgColor,
                                                        color: getFeedbackStatus(proc.seek_feedback).color,
                                                        WebkitAppearance: 'none',
                                                        MozAppearance: 'none',
                                                        appearance: 'none',
                                                    }}
                                                >
                                                    <option value="not_required">Not Required</option>
                                                    <option value="feedback_requested">Feedback Requested</option>
                                                    <option value="discussed">Discussed</option>
                                                </select>
                                                <svg viewBox="0 0 10 6" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 8, height: 5, pointerEvents: 'none', color: getFeedbackStatus(proc.seek_feedback).color }} xmlns="http://www.w3.org/2000/svg">
                                                    <path d="M0 0 L5 6 L10 0" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
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
                                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Edit Profile</h3>
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
                                        New password (leave blank to keep current)
                                        <input
                                            type="password"
                                            value={profileForm.password}
                                            onChange={(e) => setProfileForm(prev => ({ ...prev, password: e.target.value }))}
                                            style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                                            placeholder="new password"
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
