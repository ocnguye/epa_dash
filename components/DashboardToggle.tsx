"use client";

import React from 'react';
import { useRouter, usePathname } from 'next/navigation';

type Props = {
  className?: string;
  // paths to navigate between. Defaults preserve existing behavior for non-admin pages.
  epaPath?: string;
  rprPath?: string;
};

export default function DashboardToggle({ className, epaPath = '/epadash', rprPath = '/rprdash' }: Props) {
  const router = useRouter();
  const pathname = usePathname() || '';

  const onClick = () => {
    // Toggle: if currently on epaPath, go to rprPath, otherwise go to epaPath
    if (pathname.startsWith(epaPath)) {
      router.push(rprPath);
    } else {
      router.push(epaPath);
    }
  };

  const isEpa = pathname.startsWith(epaPath);

  return (
    <button
      onClick={onClick}
      className={className}
      style={{
        // always use the lighter blue so the control is visually prominent and consistent
        background: 'linear-gradient(135deg, #60a5fa, #3b82f6)',
        color: '#fff',
        border: '1px solid rgba(55,65,81,0.08)',
        borderRadius: 8,
        padding: '10px 18px',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.12s ease',
        boxShadow: isEpa ? '0 1px 2px rgba(0,0,0,0.04)' : '0 1px 2px rgba(0,0,0,0.06)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
      }}
      title={isEpa ? `Switch to ${rprPath}` : `Switch to ${epaPath}`}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
        (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 8px rgba(0,0,0,0.12)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
        (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.06)';
      }}
    >
      {/* Icon: swap / arrows to match other header buttons' style */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {/* Dashboard/grid icon (2x2) to match other button icon sizing */}
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
      <span>{isEpa ? 'Switch to RPR' : 'Switch to EPA'}</span>
    </button>
  );
}
