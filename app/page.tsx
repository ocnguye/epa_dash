'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [preferredDashboard, setPreferredDashboard] = useState<'epadash' | 'rprdash'>('epadash');
    const router = useRouter();

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
                // After successful login, check role and route appropriately
                try {
                    const meRes = await fetch('/api/dashboard');
                    if (meRes.ok) {
                        const meJson = await meRes.json();
                        const role = meJson?.user?.role;
                            if (role === 'attending') {
                                router.push('/admin');
                            } else {
                                // route to the dashboard the user selected on the login form
                                if (preferredDashboard === 'rprdash') router.push('/rprdash');
                                else router.push('/epadash');
                            }
                    } else {
                        // Fallback to trainee dashboard
                        if (preferredDashboard === 'rprdash') router.push('/rprdash');
                        else router.push('/epadash');
                    }
                } catch (err) {
                    // network or other error; fallback
                    if (preferredDashboard === 'rprdash') router.push('/rprdash');
                    else router.push('/epadash');
                }
            } else {
                // Provide a clear credential mismatch message for failed logins
                setError('Username and password do not match');
            }
        } catch (err) {
            setError('Server error. Please try again.');
        }
    };

    return (
        <div
            style={{
                display: 'flex',
                minHeight: '100vh',
                fontFamily: 'Ubuntu',
            }}
        >
            {/* Left side: Login form */}
            <div
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
                    style={{
                        width: '100%',
                        maxWidth: 400,
                        padding: 30,
                        background: '#fff',
                        borderRadius: 8,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                    }}
                >

                    <h3 style={{ textAlign: 'center', marginBottom: 20, color: '#0000008b', fontSize: 14, fontWeight: 200 }}>
                        Please enter your credentials
                    </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                            <label style={{ fontSize: 16, fontWeight: 600, color: '#000', marginBottom: 4 }}>Dashboard</label>
                            <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
                                <select
                                    value={preferredDashboard}
                                    onChange={e => setPreferredDashboard(e.target.value as 'epadash' | 'rprdash')}
                                    style={{
                                        width: '100%',
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
                    <form onSubmit={handleSubmit}>
                        <label
                            htmlFor="username"
                            style={{
                                display: 'block',
                                marginBottom: 5,
                                color: '#000',
                                fontSize: 16,
                                fontWeight: 600,
                            }}
                        >
                            Username
                        </label>
                        <input
                            type="text"
                            id="username"
                            name="username"
                            required
                            value={username}
                            onChange={e => { setUsername(e.target.value); if (error) setError(''); }}
                            style={{
                                width: '100%',
                                padding: 8,
                                marginBottom: 15,
                                border: '1px solid #ccc',
                                borderRadius: 4,
                                color: '#0000008b',
                            }}
                        />

                        <label
                            htmlFor="password"
                            style={{
                                display: 'block',
                                marginBottom: 5,
                                color: '#000',
                                fontSize: 16,
                                fontWeight: 600,
                            }}
                        >
                            Password
                        </label>
                        <input
                            type="password"
                            id="password"
                            name="password"
                            required
                            value={password}
                            onChange={e => { setPassword(e.target.value); if (error) setError(''); }}
                            style={{
                                width: '100%',
                                padding: 8,
                                marginBottom: 15,
                                border: '1px solid #ccc',
                                borderRadius: 4,
                                color: '#0000008b',
                            }}
                        />

                        <button
                            type="submit"
                            style={{
                                width: '100%',
                                padding: 10,
                                background: '#c8ceee',
                                color: '#000',
                                border: 'none',
                                borderRadius: 4,
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: 16,
                            }}
                        >
                            Login
                        </button>
                        {error && (
                            <div role="alert" style={{ color: '#b91c1c', marginTop: 12, fontSize: 13 }}>
                                {error}
                            </div>
                        )}
                    </form>
                </div>
            </div>
            {/* Right side: Gradient and image */}
            <div
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