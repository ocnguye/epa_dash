'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const PASSWORD_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_PASSWORD_LOGIN === 'true';

const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: 8,
    marginBottom: 15,
    border: '1px solid #ccc',
    borderRadius: 4,
    color: '#0000008b',
    fontSize: 16, // 16px prevents iOS zoom-on-focus
    minHeight: 40,
};

const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: 5,
    color: '#000',
    fontSize: 16,
    fontWeight: 600,
};

const primaryButtonStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: 10,
    minHeight: 44,
    background: '#c8ceee',
    color: '#000',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 16,
};

export default function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [preferredDashboard, setPreferredDashboard] = useState<'epadash' | 'rprdash'>('epadash');
    const router = useRouter();

    // If Emory's IdP sent us back with an error, show it here
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const err = params.get('error');
        if (err === 'not_authorized') {
            setError('Your Emory account is not registered for this dashboard. Contact an administrator.');
        } else if (err === 'sso_failed') {
            setError('Sign-in with Emory failed. Please try again.');
        } else if (err) {
            setError('Sign-in failed. Please try again.');
        }
    }, []);

    const rememberDashboard = () => {
        sessionStorage.setItem('preferredDashboard', preferredDashboard);
    };

    const handleSSO = () => {
        setError('');
        rememberDashboard();
        window.location.href = '/api/auth/saml/login';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = await res.json();
            if (data.success) {
                rememberDashboard();
                router.push('/post-login');
            } else {
                setError('Username and password do not match');
            }
        } catch (err) {
            setError('Server error. Please try again.');
        }
    };

    return (
        <div
            className="login-page"
            style={{
                display: 'flex',
                minHeight: '100vh',
                fontFamily: 'Ubuntu',
            }}
        >
            <style jsx>{`
                @media (max-width: 900px) {
                    .login-page {
                        flex-direction: column !important;
                        min-height: 100dvh !important;
                        background: linear-gradient(135deg, #c8ceee 30%, #a7abde 100%) !important;
                    }
                    .login-left {
                        width: 100% !important;
                        flex: 1 1 auto !important;
                        background: transparent !important;
                        padding: 32px 16px !important;
                        box-sizing: border-box !important;
                    }
                    .login-title {
                        font-size: 28px !important;
                        margin-bottom: 20px !important;
                        letter-spacing: 0 !important;
                    }
                    .login-card {
                        padding: 20px !important;
                        box-sizing: border-box !important;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.12) !important;
                    }
                    .login-right { display: none !important; }
                }
                @media (max-width: 480px) {
                    .login-left { padding: 24px 12px !important; }
                    .login-title { font-size: 24px !important; }
                    .login-card { padding: 16px !important; }
                }
            `}</style>

            {/* Left side: Login form */}
            <div
                className="login-left"
                style={{
                    width: '33.33%',
                    background: '#fff',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: '0 40px',
                }}
            >
                <h1
                    className="login-title"
                    style={{
                        fontSize: 42,
                        fontWeight: 700,
                        color: '#22223b',
                        marginBottom: 32,
                        textAlign: 'center',
                        letterSpacing: 1,
                    }}
                >
                    Welcome to Your Resident Dashboard
                </h1>
                <div
                    className="login-card"
                    style={{
                        width: '100%',
                        maxWidth: 400,
                        padding: 30,
                        background: '#fff',
                        borderRadius: 8,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                    }}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                        <label htmlFor="dashboard-select" style={{ fontSize: 16, fontWeight: 600, color: '#000', marginBottom: 4 }}>Dashboard</label>
                        <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
                            <select
                                id="dashboard-select"
                                value={preferredDashboard}
                                onChange={e => setPreferredDashboard(e.target.value as 'epadash' | 'rprdash')}
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    minHeight: 40,
                                    padding: '8px 34px 8px 10px',
                                    borderRadius: 4,
                                    border: '1px solid #ccc',
                                    color: '#0000008b',
                                    fontSize: 16,
                                    fontWeight: 400,
                                    WebkitAppearance: 'none',
                                    MozAppearance: 'none',
                                    appearance: 'none'
                                }}
                            >
                                <option value="epadash">EPA Dashboard</option>
                                <option value="rprdash">RPR Dashboard</option>
                            </select>
                            <svg viewBox="0 0 24 24" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, pointerEvents: 'none', color: 'rgba(74,144,226,1)' }} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </div>
                    </div>

                    <button type="button" onClick={handleSSO} style={primaryButtonStyle}>
                        Sign in with Emory
                    </button>

                    {PASSWORD_LOGIN_ENABLED && (
                        <form onSubmit={handleSubmit} style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #eee' }}>
                            <h3 style={{ textAlign: 'center', marginBottom: 20, color: '#0000008b', fontSize: 14, fontWeight: 200 }}>
                                Development Login
                            </h3>
                            <label htmlFor="username" style={labelStyle}>
                                Username
                            </label>
                            <input
                                type="text"
                                id="username"
                                name="username"
                                autoComplete="username"
                                autoCapitalize="none"
                                autoCorrect="off"
                                required
                                value={username}
                                onChange={e => { setUsername(e.target.value); if (error) setError(''); }}
                                style={inputStyle}
                            />

                            <label htmlFor="password" style={labelStyle}>
                                Password
                            </label>
                            <input
                                type="password"
                                id="password"
                                name="password"
                                autoComplete="current-password"
                                required
                                value={password}
                                onChange={e => { setPassword(e.target.value); if (error) setError(''); }}
                                style={inputStyle}
                            />

                            <button type="submit" style={primaryButtonStyle}>
                                Login
                            </button>
                        </form>
                    )}

                    {error && (
                        <div role="alert" style={{ color: '#b91c1c', marginTop: 12, fontSize: 13 }}>
                            {error}
                        </div>
                    )}
                </div>
            </div>

            {/* Right side: Gradient and image (hidden on mobile) */}
            <div
                className="login-right"
                style={{
                    width: '66.67%',
                    background: 'linear-gradient(135deg, #c8ceee 30%, #a7abde 70%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                {/* Temporary image from Freepik */}
                <img
                    src="/26992.jpg"
                    alt="Dashboard Visual"
                    style={{
                        maxWidth: '70%',
                        maxHeight: '70%',
                        objectFit: 'contain',
                        borderRadius: 16,
                        boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
                    }}
                />
            </div>
        </div>
    );
}