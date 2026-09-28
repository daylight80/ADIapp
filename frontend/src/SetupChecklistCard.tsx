import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useFocusEffect } from 'expo-router';
import { Check, ChevronDown, ChevronRight, ChevronUp, X } from 'lucide-react-native';
import { useAuth } from './AuthContext';
import { isPaidTier } from './tiers';
import {
  getInstructorProfile, getMySchoolProfile, getMyInstructorCreatedAt, hasAnyLesson, listMyDeadlineItems,
  type Student,
} from './supabaseDb';
import {
  buildChecklist, checklistProgress, nextStep, shouldShowChecklist, type ChecklistSignals,
} from './setupChecklist';

/**
 * Home-screen "Getting started" checklist for new instructors (28 Sept 2026).
 *
 * Shows a compact progress card for accounts in their first 30 days, expandable
 * to the full list, each pending step opening the screen that does it. Every
 * step ticks itself from real data (setupChecklist.ts), so there is nothing to
 * mark as done. It disappears when finished or dismissed.
 *
 * It waits for ALL of its data before deciding anything, so it never flashes a
 * wrong "not done" tick, and reports its state to Home through onShowingChange:
 * null while still loading, then true/false. Home uses that to keep the
 * referral banner out of the way while the checklist is up (and, while it is
 * still null, to avoid flashing the referral banner and then removing it).
 * A failed load just means "not showing" — a nudge failing to appear isn't
 * worth an error state.
 */

const C = {
  card: '#FFFFFF',
  border: '#E4DED2',
  text: '#0F172A',
  muted: '#64748B',
  track: '#EAE5DA',
  primary: '#00539F',
  accent: '#FF6B00',
  success: '#10B981',
};

const dismissKey = (instructorId: string) => `setup_checklist_dismissed_v1:${instructorId}`;

type Props = {
  /** Home already loads the students, so they are passed in rather than fetched twice. */
  students: Student[];
  onShowingChange?: (showing: boolean | null) => void;
};

type Loaded = {
  adiNumber: string | null;
  mobileNumber: string | null;
  numberPlate: string | null;
  hasLesson: boolean;
  deadlineCount: number;
  hasLogo: boolean;
  createdAt: string | null;
};

export function SetupChecklistCard({ students, onShowingChange }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const tier = user?.tier;
  const instructorId = user?.instructor_id as string | undefined;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!instructorId) return;
    let cancelled = false;
    AsyncStorage.getItem(dismissKey(instructorId))
      .then((v) => { if (!cancelled) setDismissed(v === 'true'); })
      .catch(() => { if (!cancelled) setDismissed(false); });
    return () => { cancelled = true; };
  }, [instructorId]);

  // Reload on focus so a step ticks as soon as the instructor comes back from doing it.
  useFocusEffect(
    useCallback(() => {
      if (!instructorId) return;
      let cancelled = false;
      Promise.all([
        getInstructorProfile(),
        tier === 'pro' ? getMySchoolProfile() : Promise.resolve(null),
        isPaidTier(tier) ? listMyDeadlineItems() : Promise.resolve([]),
        hasAnyLesson(instructorId),
        getMyInstructorCreatedAt(),
      ])
        .then(([profile, school, deadlines, hasLesson, createdAt]) => {
          if (cancelled) return;
          setLoaded({
            adiNumber: profile?.adi_number ?? null,
            mobileNumber: profile?.mobile_number ?? null,
            numberPlate: profile?.number_plate ?? null,
            hasLesson,
            deadlineCount: deadlines.length,
            hasLogo: !!(school?.logo_url && school.logo_url.trim()),
            createdAt,
          });
          setFailed(false);
        })
        .catch(() => { if (!cancelled) setFailed(true); });
      return () => { cancelled = true; };
    }, [instructorId, tier]),
  );

  const steps = useMemo(() => {
    if (!loaded) return [];
    const signals: ChecklistSignals = {
      adiNumber: loaded.adiNumber,
      mobileNumber: loaded.mobileNumber,
      numberPlate: loaded.numberPlate,
      studentCount: students.length,
      hasLesson: loaded.hasLesson,
      anyStudentOnApp: students.some((s) => !!s.auth_user_id),
      deadlineCount: loaded.deadlineCount,
      hasLogo: loaded.hasLogo,
    };
    return buildChecklist(signals, tier);
  }, [loaded, students, tier]);

  const show: boolean | null =
    !instructorId || failed ? false  // nothing to load, or the load failed: not showing (never stay "loading" forever)
    : loaded === null || dismissed === null ? null
    : shouldShowChecklist({ steps, createdAt: loaded.createdAt, dismissed });

  useEffect(() => { onShowingChange?.(show); }, [show, onShowingChange]);

  if (!show) return null;

  const { done, total } = checklistProgress(steps);
  const next = nextStep(steps);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const dismiss = () => {
    setDismissed(true);
    if (instructorId) AsyncStorage.setItem(dismissKey(instructorId), 'true').catch(() => {});
  };

  return (
    <View style={s.card} testID="setup-checklist">
      <View style={s.headRow}>
        <TouchableOpacity
          style={s.headMain}
          onPress={() => setExpanded((v) => !v)}
          activeOpacity={0.7}
          accessibilityLabel={expanded ? 'Collapse checklist' : 'Expand checklist'}
          testID="setup-checklist-toggle"
        >
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Getting started</Text>
            <Text style={s.progressText} testID="setup-checklist-progress">{done} of {total} done</Text>
          </View>
          {expanded ? <ChevronUp size={18} color={C.muted} /> : <ChevronDown size={18} color={C.muted} />}
        </TouchableOpacity>
        <TouchableOpacity onPress={dismiss} style={s.closeBtn} accessibilityLabel="Hide checklist" testID="setup-checklist-dismiss">
          <X size={16} color={C.muted} />
        </TouchableOpacity>
      </View>

      <View style={s.track}>
        <View style={[s.fill, { width: `${pct}%` }]} />
      </View>

      {!expanded && next && (
        <TouchableOpacity
          style={s.nextRow}
          onPress={() => router.push(next.route as any)}
          activeOpacity={0.7}
          testID="setup-checklist-next"
        >
          <View style={{ flex: 1 }}>
            <Text style={s.nextLabel}>Next</Text>
            <Text style={s.nextTitle}>{next.title}</Text>
          </View>
          <ChevronRight size={18} color={C.primary} />
        </TouchableOpacity>
      )}

      {expanded && (
        <View style={{ marginTop: 6 }}>
          {steps.map((step) => (
            <TouchableOpacity
              key={step.id}
              style={s.stepRow}
              disabled={step.done}
              onPress={() => router.push(step.route as any)}
              activeOpacity={0.7}
              testID={`setup-step-${step.id}`}
            >
              <View style={[s.dot, step.done && s.dotDone]}>
                {step.done && <Check size={13} color="#fff" strokeWidth={3} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.stepTitle, step.done && s.stepTitleDone]}>{step.title}</Text>
                {!step.done && <Text style={s.stepHint}>{step.hint}</Text>}
              </View>
              {!step.done && <ChevronRight size={16} color={C.primary} />}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    marginHorizontal: 20, marginTop: 12, backgroundColor: C.card, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, padding: 14,
  },
  headRow: { flexDirection: 'row', alignItems: 'flex-start' },
  headMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: 'Archivo_800ExtraBold', fontSize: 16, letterSpacing: -0.3, color: C.text },
  progressText: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: C.muted, marginTop: 1 },
  closeBtn: { padding: 6, marginLeft: 4, marginTop: -2 },
  track: { height: 6, borderRadius: 999, backgroundColor: C.track, marginTop: 10, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 999, backgroundColor: C.accent },
  nextRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  nextLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted },
  nextTitle: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: C.primary, marginTop: 1 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  dot: {
    width: 22, height: 22, borderRadius: 999, borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  dotDone: { backgroundColor: C.success, borderColor: C.success },
  stepTitle: { fontFamily: 'Barlow_700Bold', fontSize: 14.5, color: C.text },
  stepTitleDone: { color: C.muted, textDecorationLine: 'line-through', fontFamily: 'Barlow_500Medium' },
  stepHint: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, color: C.muted, marginTop: 1 },
});
