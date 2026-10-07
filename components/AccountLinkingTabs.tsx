'use client';

import { useState } from 'react';
import AdminLinkingPanel from './AdminLinkingPanel';
import ManageAccessPanel from './ManageAccessPanel';

export default function AccountLinkingTabs() {
  const [tab, setTab] = useState<'new' | 'manage'>('new');

  const btn = (t: 'new' | 'manage', text: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        fontSize: 14, padding: '8px 18px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
        border: `1px solid ${tab === t ? '#afd5f0' : 'rgba(55,65,81,0.08)'}`,
        background: tab === t ? 'rgba(175, 213, 240, 0.9)' : '#fff',
        color: '#374151', fontWeight: tab === t ? 700 : 500,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      {text}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {btn('new', 'New sign-ins')}
        {btn('manage', 'Manage access')}
      </div>
      {tab === 'new' ? <AdminLinkingPanel /> : <ManageAccessPanel />}
    </div>
  );
}