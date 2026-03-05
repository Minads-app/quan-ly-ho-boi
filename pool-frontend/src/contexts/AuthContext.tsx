/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';
import type { User } from '@supabase/supabase-js';

interface AuthState {
    user: User | null;
    profile: Profile | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<string | null>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);

    async function fetchProfile(userId: string) {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (error) {
                // Fetch thất bại (timeout, mạng) → giữ nguyên profile cũ, không logout
                console.warn('Profile fetch failed, keeping existing session:', error.message);
                setLoading(false);
                return;
            }

            if (data && data.is_active === false) {
                await supabase.auth.signOut();
                setProfile(null);
                setUser(null);
            } else if (data) {
                setProfile(data);
            }
            // Nếu data = null nhưng không lỗi → giữ nguyên profile cũ
        } catch (err) {
            console.warn('Profile fetch exception:', err);
        }
        setLoading(false);
    }

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchProfile(session.user.id);
            } else {
                setLoading(false);
            }
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchProfile(session.user.id);
            } else {
                setProfile(null);
                setLoading(false);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    async function signIn(email: string, password: string): Promise<string | null> {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return error.message;

        if (data.user) {
            const { data: profileData } = await supabase
                .from('profiles')
                .select('is_active')
                .eq('id', data.user.id)
                .single();

            if (profileData && profileData.is_active === false) {
                await supabase.auth.signOut();
                return 'Tài khoản của bạn đã bị vô hiệu hóa. Vui lòng liên hệ Quản trị viên.';
            }
        }

        return null;
    }

    async function signOut() {
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
    }

    return (
        <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
