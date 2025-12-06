"use client";

import React, { useEffect, useState } from 'react';
import RprTable from '../../components/RprTable';
import RprSummary from '../../components/RprSummary';

type Row = Record<string, any>;

export default function RprDashPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        fetch('/api/rpr')
            .then(res => res.json())
            .then((payload) => {
                if (!mounted) return;
                if (payload && payload.success) {
                    setRows(payload.data || []);
                } else if (payload && !payload.success) {
                    setError(payload.message || 'API returned an error');
                } else {
                    setError('Unexpected API response');
                }
            })
            .catch((e) => {
                if (!mounted) return;
                setError(String(e?.message || e));
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });
        return () => { mounted = false; };
    }, []);

    return (
        <div style={{ padding: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 12 }}>RPR Dashboard</div>

            {loading ? (
                <div style={{ padding: 20, background: '#fff', borderRadius: 8 }}>Loading…</div>
            ) : error ? (
                <div style={{ padding: 20, background: '#fff', borderRadius: 8, color: 'red' }}>{error}</div>
            ) : (
                <>
                    <RprSummary rows={rows} />
                    <RprTable rows={rows} />
                </>
            )}
        </div>
    );
}
