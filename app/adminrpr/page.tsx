"use client";

import React, { useEffect, useState } from 'react';
import DashboardToggle from '../../components/DashboardToggle';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const ResidencyAnalyticsWrapper = dynamic(
  () => import('../../components/ResidencyAnalytics'),
  { ssr: false }
);
const StudiesTimeSeriesWrapper = dynamic(
  () => import('../../components/StudiesTimeSeries'),
  { ssr: false }
);

type TabKey = 'Residency Analytics' | 'Studies Time Series';

const TAB_WIDTH = 240; // 🔧 EPA-style narrow tabs
const TAB_HEIGHT = 44;
const TAB_OVERLAP = 10;

export default function AdminRprPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('Residency Analytics');

  const tabs: readonly TabKey[] = [
    'Residency Analytics',
    'Studies Time Series',
  ];

  /* ---------------- AUTH GUARD ---------------- */
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
      <div style={{ maxWidth: 'calc(100vw - 40px)', margin: '0 auto' }}>
        {/* ---------------- HEADER ---------------- */}
        <div
          style={{
            background: '#fff',
            borderRadius: 16,
            padding: 24,
            marginBottom: 20,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 32,
                fontWeight: 700,
                color: '#111827',
              }}
            >
              RPR Attending Dashboard
            </h1>
            <div
              style={{
                marginTop: 6,
                color: '#374151',
                fontSize: 16,
              }}
            >
              {currentUser &&
                `Welcome to your hub for reviewing trainee RPR scores, Dr. ${
                  currentUser.preferred_name?.trim() || currentUser.first_name
                } ${currentUser.last_name}`}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <DashboardToggle epaPath="/adminepa" rprPath="/adminrpr" />
            <button
              onClick={() => router.push('/')}
              style={{
                background: 'linear-gradient(135deg,#ff6b6b,#ee5a52)',
                color: '#fff',
                borderRadius: 8,
                padding: '10px 18px',
                fontWeight: 600,
              }}
            >
              Logout
            </button>
          </div>
        </div>

        {/* ---------------- TABBED SECTION (EPA STYLE) ---------------- */}
        <div style={{ position: 'relative' }}>
          {/* -------- TABS (narrow, behind card) -------- */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: -TAB_HEIGHT + 6, // 🔧 tuck behind card
              zIndex: 2,
              position: 'relative',
            }}
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
                  borderBottom:
                    activeTab === tab ? '1px solid #fff' : undefined,
                  borderRadius: '8px 8px 0 0',
                  marginLeft: i ? `-${TAB_OVERLAP}px` : 0,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  boxShadow:
                    activeTab === tab
                      ? '0 -2px 6px rgba(0,0,0,0.18)'
                      : '0 -1px 4px rgba(0,0,0,0.08)',
                  zIndex: tabs.length - i,
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* -------- MAIN CARD -------- */}
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 24,
              minHeight: '70vh',
              boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
              position: 'relative',
              zIndex: 5, // 🔧 above tabs
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ flex: 1, minHeight: 0 }}>
              {activeTab === 'Residency Analytics' && (
                <ResidencyAnalyticsWrapper />
              )}
              {activeTab === 'Studies Time Series' && (
                <StudiesTimeSeriesWrapper />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
