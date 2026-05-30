import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export type Role = 'instructor' | 'student' | 'owner';

export type User = {
  id: string;                         // Supabase auth.users.id
  email: string;
  name: string;
  role: Role;
  // Instructor / school context
  school_id?: string | null;
  instructor_id?: string | null;
  student_id?: string | null;
  adi_number?: string | null;
  subscription_status?: 'free' | 'active' | 'past_due' | 'cancelled' | 'trialing';
  tier?: 'starter' | 'growth' | 'pro' | 'franchise';
  created_at: string;
};

type SignUpResult = { ok: boolean; error?: string; needs_confirmation?: boolean };

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<SignUpResult>;
  signUp: (email: string, password: string, name: string, adi_number: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  acceptInvite: (invite_token: string, password: string, name?: string) => Promise<SignUpResult>;
  forgotPassword: (email: string) => Promise<SignUpResult>;
  updatePassword: (newPassword: string) => Promise<SignUpResult>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadProfile(session: Session): Promise<User> {
  const authUser = session.user;
  const email = authUser.email || '';
  const meta = (authUser.user_metadata || {}) as Record<string, any>;
  const fallbackName = meta.name || meta.full_name || email.split('@')[0];

  // 1) Try instructor lookup — single source of truth for instructor role
  const { data: instructor } = await supabase
    .from('instructors')
    .select('id, full_name, adi_number, school_id, driving_schools(id, business_name, subscription_status, tier)')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();

  if (instructor) {
    return {
      id: authUser.id,
      email,
      name: instructor.full_name,
      role: 'instructor',
      school_id: instructor.school_id,
      instructor_id: instructor.id,
      adi_number: instructor.adi_number,
      subscription_status: (instructor as any).driving_schools?.subscription_status || 'free',
      tier: (instructor as any).driving_schools?.tier || 'starter',
      created_at: authUser.created_at || new Date().toISOString(),
    };
  }

  // 2) Try student lookup (by email match — students don't have auth_user_id in the spec'd schema)
  const { data: student } = await supabase
    .from('students')
    .select('id, full_name, school_id, instructor_id')
    .eq('email', email)
    .maybeSingle();

  if (student) {
    return {
      id: authUser.id,
      email,
      name: student.full_name,
      role: 'student',
      school_id: student.school_id,
      instructor_id: student.instructor_id,
      student_id: student.id,
      subscription_status: 'free',
      created_at: authUser.created_at || new Date().toISOString(),
    };
  }

  // 3) Fall back to basic user info from auth metadata (e.g. just signed up,
  //    school/instructor rows haven't been created yet for some reason).
  return {
    id: authUser.id,
    email,
    name: fallbackName,
    role: (meta.role as Role) || 'instructor',
    subscription_status: 'free',
    created_at: authUser.created_at || new Date().toISOString(),
  };
}

// Bootstrap school + instructor rows for a freshly-signed-up instructor.
// Idempotent — if rows already exist for this auth user, it returns them.
async function ensureInstructorBootstrap(args: {
  authUserId: string;
  email: string;
  name: string;
  adi_number: string;
}) {
  // 1. Find or create a driving_school owned by this auth user.
  let schoolId: string | null = null;
  const { data: existingSchool } = await supabase
    .from('driving_schools')
    .select('id')
    .eq('owner_auth_id', args.authUserId)
    .maybeSingle();

  if (existingSchool) {
    schoolId = existingSchool.id;
  } else {
    const businessName = `${args.name.split(' ')[0]}'s Driving School`;
    const { data: school, error: schoolErr } = await supabase
      .from('driving_schools')
      .insert({
        business_name: businessName,
        owner_auth_id: args.authUserId,
        subscription_status: 'free',
      })
      .select('id')
      .single();
    if (schoolErr) throw schoolErr;
    schoolId = school.id;
  }

  // 2. Find or create the instructor row linked to this auth user.
  const { data: existingInstructor } = await supabase
    .from('instructors')
    .select('id')
    .eq('auth_user_id', args.authUserId)
    .maybeSingle();

  if (!existingInstructor) {
    const { error: instErr } = await supabase.from('instructors').insert({
      school_id: schoolId,
      auth_user_id: args.authUserId,
      full_name: args.name,
      adi_number: args.adi_number,
    });
    if (instErr) throw instErr;
  }

  return { schoolId };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount + subscribe to auth state changes
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setSession(data.session);
        if (data.session) {
          const profile = await loadProfile(data.session);
          if (active) setUser(profile);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, newSession) => {
      setSession(newSession);
      if (!newSession) {
        setUser(null);
        return;
      }
      try {
        const profile = await loadProfile(newSession);
        setUser(profile);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[auth] loadProfile failed', e);
      }
    });

    return () => {
      active = false;
      sub?.subscription.unsubscribe();
    };
  }, []);

  const signIn: AuthContextType['signIn'] = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, []);

  const signUp: AuthContextType['signUp'] = useCallback(async (email, password, name, adi_number) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { name, role: 'instructor', adi_number },
      },
    });
    if (error) return { ok: false, error: error.message };

    // If email confirmation is enabled, signUp returns user but no session.
    if (!data.session) {
      return {
        ok: true,
        needs_confirmation: true,
        error: 'Please check your email to confirm your account, then sign in.',
      };
    }

    // Session present — bootstrap school + instructor rows.
    try {
      await ensureInstructorBootstrap({
        authUserId: data.user!.id,
        email: data.user!.email!,
        name,
        adi_number,
      });
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Profile setup failed' };
    }
    return { ok: true };
  }, []);

  const acceptInvite: AuthContextType['acceptInvite'] = useCallback(async (invite_token, password, name) => {
    // Invite redemption is still served by the FastAPI invite registry until
    // we migrate it. For now, just sign up the email passed via metadata.
    // The invite-preview screen captures the email; we expect the caller to
    // supply it through the invite_token (encoded base64 'email:school' for now).
    try {
      const decoded = (() => {
        try {
          return JSON.parse(atob(invite_token));
        } catch {
          return null;
        }
      })();
      const email: string | undefined = decoded?.email;
      if (!email) return { ok: false, error: 'Invalid invite token' };
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name: name || email.split('@')[0], role: 'student' } },
      });
      if (error) return { ok: false, error: error.message };
      if (!data.session) return { ok: true, needs_confirmation: true, error: 'Please confirm your email to finish signing up.' };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Invite acceptance failed' };
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  // Sends Supabase Auth's "Reset Password" email. The redirectTo URL is where
  // the recovery link lands; we route that to /reset-password-screen which
  // captures the access_token from the URL hash and lets the user pick a new
  // password.
  const forgotPassword: AuthContextType['forgotPassword'] = useCallback(async (email) => {
    try {
      // On native, redirect via the app's URL scheme; on web, use the current
      // origin so the link always opens this exact deployment.
      const redirectTo =
        typeof window !== 'undefined' && window.location?.origin
          ? `${window.location.origin}/reset-password-screen`
          : 'adipro://reset-password-screen';
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Could not send reset email' };
    }
  }, []);

  // Updates the signed-in user's password. Must be called from a session
  // established by the recovery link (Supabase auto-creates this session when
  // the user arrives on the reset page with the access_token in the URL hash).
  const updatePassword: AuthContextType['updatePassword'] = useCallback(async (newPassword) => {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Password update failed' };
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const profile = await loadProfile(data.session);
    setUser(profile);
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut, refreshUser, acceptInvite, forgotPassword, updatePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
