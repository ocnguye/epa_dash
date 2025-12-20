"use client";

import React, { useEffect, useRef, useState } from 'react';
import DashboardToggle from '../../components/DashboardToggle';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const ResidencyAnalyticsWrapper = dynamic(() => import('../../components/ResidencyAnalytics'), { ssr: false });
const StudiesTimeSeriesWrapper = dynamic(() => import('../../components/StudiesTimeSeries'), { ssr: false });

type TabKey = 'Residency Analytics' | 'Studies Time Series';

const TAB_WIDTH = 240;
const TAB_HEIGHT = 44;
const TAB_OVERLAP = 10;

export default function AdminRprPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('Residency Analytics');

  const tabs: readonly TabKey[] = ['Residency Analytics', 'Studies Time Series'];

  // measure the rendered tab row height so we can position the content exactly
  const tabRowRef = useRef<HTMLDivElement | null>(null);
  const [measuredTabHeight, setMeasuredTabHeight] = useState<number>(TAB_HEIGHT);

  useEffect(() => {
    if (!tabRowRef.current) return;
    const el = tabRowRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = Math.round(entry.contentRect.height || TAB_HEIGHT);
        setMeasuredTabHeight(h);
      }
    });
    ro.observe(el);
    // set initial
    setMeasuredTabHeight(Math.round(el.getBoundingClientRect().height || TAB_HEIGHT));
    return () => ro.disconnect();
  }, [tabRowRef]);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/dashboard');
      if (!res.ok) return router.push('/');
      const data = await res.json();
      if (!data.user || data.user.role !== 'attending') {
        router.push('/');
      } else {
        setCurrentUser(data.user);
      }
    })();
  }, [router]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #c8ceee 30%, #a7abde 100%)',
        padding: 20,
        fontFamily: 'Ubuntu, sans-serif',
      }}
    >
      <div style={{ maxWidth: '100%', margin: '0 auto' }}>
        {/* HEADER */}
        <div
          style={{
            background: '#fff',
            borderRadius: 16,
            padding: 24,
            marginBottom: 20,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 700, color: '#111827' }}>RPR Attending Dashboard</h1>
            <div style={{ marginTop: 6, color: '#374151', fontSize: 16 }}>
              {currentUser && `Welcome to your hub for reviewing trainee RPR scores, Dr. ${currentUser.preferred_name?.trim() || currentUser.first_name} ${currentUser.last_name}`}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <DashboardToggle epaPath="/adminepa" rprPath="/adminrpr" />
            </div>
            <button
              onClick={() => router.push('/')}
              style={{
                background: 'linear-gradient(135deg,#ff6b6b,#ee5a52)',
                color: '#fff',
                borderRadius: 8,
                padding: '10px 18px',
                height: 40,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Logout
            </button>
          </div>
        </div>

        {/* TABBED SECTION */}
        <div style={{ position: 'relative' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              // keep tab row in normal flow; we'll lift the chart card itself so
              // it tucks under the tabs (more robust when chart components have
              // internal stacking contexts)
              marginBottom: 0,
              // render tabs in normal flow; we'll place them behind the chart by
              // lowering their stacking context so the card and decorative cover sit above
              zIndex: 1,
              position: 'relative',
              pointerEvents: 'auto',
            }}
            ref={tabRowRef}
          >
            {tabs.map((tab, i) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  width: TAB_WIDTH,
                  height: TAB_HEIGHT,
                  background: activeTab === tab ? '#6b7280' : '#e5e7fa',
                  color: activeTab === tab ? '#fff' : '#111827',
                  border: '1px solid rgba(107,114,128,0.4)',
                  borderBottom: activeTab === tab ? '1px solid #fff' : undefined,
                  borderRadius: '8px 8px 0 0',
                  marginLeft: i ? `-${TAB_OVERLAP}px` : 0,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  boxShadow: activeTab === tab ? '0 -2px 6px rgba(0,0,0,0.18)' : '0 -1px 4px rgba(0,0,0,0.08)',
          // keep buttons in the low stacking context so the chart card can sit above
            position: 'relative',
            // ensure left tabs layer above right tabs by assigning higher z-index
            // to tabs with lower index (i=0 on left). Keep values < chart zIndex (15).
            zIndex: 5 + (tabs.length - i),
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* area (outer wrapper removed) */}
          <div
            style={{
              background: 'transparent',
              borderRadius: 0,
              padding: 24,
              // small top margin to avoid clipping on very small measured heights
              // set to 0 to remove accidental gap between tabs and card
              marginTop: 4,
              minHeight: '78vh',
              boxShadow: 'none',
              position: 'relative',
              // keep content below the tabs
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ flex: 1, minHeight: 0 }}>
              <div
                style={{
                  // keep wrapper the same width as the header container
                  position: 'relative',
                  zIndex: 15,
                  marginTop: -(Math.round(measuredTabHeight - 8)),
                  pointerEvents: 'auto',
                  // expand this inner wrapper out by the same horizontal padding
                  // used on the outer area (24px each side) so the chart card
                  // lines up with the header. We offset back with a negative
                  // left margin so the visual width matches the sibling header.
                  width: 'calc(100% + 48px)',
                  marginLeft: -24,
                  boxSizing: 'border-box',
                }}
              >
                {activeTab === 'Residency Analytics' && <ResidencyAnalyticsWrapper />}
                {activeTab === 'Studies Time Series' && <StudiesTimeSeriesWrapper />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}