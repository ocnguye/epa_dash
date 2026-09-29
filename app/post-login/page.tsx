'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PostLogin() {
    const router = useRouter();
    const [error, setError] = useState('');

    useEffect(() => {
        (async () => {
            const preferredDashboard =
                sessionStorage.getItem('preferredDashboard') === 'rprdash' ? 'rprdash' : 'epadash';

            try {
                const res = await fetch('/api/me');
                if (!res.ok) {
                    router.replace('/');
                    return;
                }

                const data = await res.json();

                if (!data.authenticated) {
                    router.replace(data.accounts?.length ? '/select-account' : '/?error=not_authorized');
                    return;
                }

                const role = data.user?.role ?? data.role;

                if (role === 'admin') {
                    router.replace('/admindash');
                } else if (role === 'attending') {
                    router.replace(preferredDashboard === 'rprdash' ? '/attendingrpr' : '/attendingepa');
                } else if (role === 'trainee') {
                    router.replace(preferredDashboard === 'rprdash' ? '/rprdash' : '/epadash');
                } else {
                    // Logged in, but no recognized role — don't guess
                    setError('Your account has no assigned role. Contact an administrator.');
                }
            } catch {
                setError('Something went wrong. Please try logging in again.');
            }
        })();
    }, [router]);

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            fontFamily: 'Ubuntu',
            gap: 12,
        }}>
            {error ? (
                <>
                    <p style={{ color: '#b91c1c' }}>{error}</p>
                    <a href="/" style={{ color: '#374151' }}>Back to login</a>
                </>
            ) : (
                <p>Signing you in…</p>
            )}
        </div>
    );
}