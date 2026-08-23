import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ArrowLeft, Building2, Camera } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { getMySchoolProfile, updateMySchoolProfile, uploadSchoolLogo, type SchoolProfile } from '../src/supabaseDb';

export default function SchoolProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<SchoolProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [businessName, setBusinessName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [address, setAddress] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [googleReviewUrl, setGoogleReviewUrl] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const p = await getMySchoolProfile();
        if (!p) {
          Alert.alert('Not found', "We couldn't find a school profile for this account.");
          router.back();
          return;
        }
        setProfile(p);
        setBusinessName(p.business_name || '');
        setContactEmail(p.contact_email || '');
        setContactPhone(p.contact_phone || '');
        setAddress(p.address || '');
        setHourlyRate(p.default_hourly_rate != null ? String(p.default_hourly_rate) : '');
        setGoogleReviewUrl(p.google_review_url || '');
      } catch (e: any) {
        Alert.alert('Could not load school profile', e?.message || 'Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    if (!businessName.trim()) {
      Alert.alert('Business name required', "This can't be left empty.");
      return;
    }
    let rateValue: number | null = null;
    if (hourlyRate.trim()) {
      const parsed = Number(hourlyRate.trim());
      if (!Number.isFinite(parsed) || parsed < 0) {
        Alert.alert('Invalid rate', 'Enter a valid hourly rate, e.g. 32.50');
        return;
      }
      rateValue = parsed;
    }
    const reviewUrl = googleReviewUrl.trim();
    if (reviewUrl && !/^https?:\/\//i.test(reviewUrl)) {
      Alert.alert('Invalid review link', 'The Google review link should start with https://');
      return;
    }
    setSaving(true);
    try {
      await updateMySchoolProfile({
        business_name: businessName.trim(),
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
        address: address.trim() || null,
        default_hourly_rate: rateValue,
        google_review_url: reviewUrl || null,
      });
      Alert.alert('Saved', 'Your school profile has been updated.');
      router.back();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handlePickLogo = async () => {
    if (!profile) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo library access to upload a logo.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      // A logo only ever renders at ~88x88px in the app, or modestly sized
      // on an invoice — there's no reason to carry a multi-megabyte photo
      // through this flow. A phone camera photo at the previous quality
      // (0.8) could be large enough that decoding it (see uploadSchoolLogo)
      // took long enough on a phone's CPU to look like a stuck spinner —
      // this never showed up in testing since every earlier logo test this
      // session was on desktop. 0.3 keeps a small square crop plenty sharp
      // while keeping the payload small.
      quality: 0.3,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    const asset = res.assets[0];
    setUploadingLogo(true);
    try {
      // A hung upload (slow network, large image slipping through, a
      // one-off backend/storage hiccup) must never leave uploadingLogo
      // stuck true forever — that permanently disables the button for the
      // rest of the page's life, blocking any further attempt including
      // with a different, smaller image. 20s is generous for a small
      // square logo; a real upload should finish in a couple of seconds.
      const uploadPromise = uploadSchoolLogo(profile.id, asset.base64!, asset.mimeType || 'image/jpeg');
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Upload timed out after 20 seconds. Please try again.')), 20000),
      );
      const url = await Promise.race([uploadPromise, timeoutPromise]);
      setProfile((prev) => (prev ? { ...prev, logo_url: url } : prev));
    } catch (e: any) {
      Alert.alert('Could not upload logo', e?.message || 'Please try again.');
    } finally {
      setUploadingLogo(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
            <ArrowLeft size={22} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>School Profile</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <Text style={styles.subtitle}>
            This appears on your invoices and, once you're on Franchise, on your dashboard header.
          </Text>

          <Card style={{ gap: 12, alignItems: 'center' }}>
            <Text style={styles.cardTitle}>Logo</Text>
            <TouchableOpacity onPress={handlePickLogo} disabled={uploadingLogo} testID="btn-pick-logo">
              <View style={styles.logoBox}>
                {uploadingLogo ? (
                  <ActivityIndicator color={theme.colors.primary} />
                ) : profile?.logo_url ? (
                  <Image source={{ uri: profile.logo_url }} style={styles.logoImage} resizeMode="cover" />
                ) : (
                  <Building2 size={32} color={theme.colors.textMuted} />
                )}
                <View style={styles.logoCameraBadge}>
                  <Camera size={14} color="#fff" />
                </View>
              </View>
            </TouchableOpacity>
            <Text style={styles.hint}>Tap to {profile?.logo_url ? 'change' : 'upload'} — square image works best.</Text>
          </Card>

          <Card style={{ gap: 10 }}>
            <Text style={styles.cardTitle}>Business details</Text>
            <Text style={styles.label}>Business name <Text style={{ color: theme.colors.danger }}>*</Text></Text>
            <TextInput
              style={styles.input}
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="e.g. Formula Jon Driving School"
              placeholderTextColor={theme.colors.textMuted}
              testID="input-business-name"
            />

            <Text style={styles.label}>Contact email</Text>
            <TextInput
              style={styles.input}
              value={contactEmail}
              onChangeText={setContactEmail}
              placeholder="hello@yourschool.co.uk"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              testID="input-contact-email"
            />

            <Text style={styles.label}>Contact phone</Text>
            <TextInput
              style={styles.input}
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder="07700 900000"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="phone-pad"
              testID="input-contact-phone"
            />

            <Text style={styles.label}>Address</Text>
            <TextInput
              style={[styles.input, { height: 70, textAlignVertical: 'top' }]}
              value={address}
              onChangeText={setAddress}
              placeholder="Business address for invoices"
              placeholderTextColor={theme.colors.textMuted}
              multiline
              testID="input-address"
            />
          </Card>

          <Card style={{ gap: 10 }}>
            <Text style={styles.cardTitle}>Pricing & reviews</Text>

            <Text style={styles.label}>Lesson price per hour (£)</Text>
            <TextInput
              style={styles.input}
              value={hourlyRate}
              onChangeText={setHourlyRate}
              placeholder="e.g. 32.50"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="decimal-pad"
              testID="input-hourly-rate"
            />
            <Text style={styles.hint}>
              A standard/default rate for reference — doesn't change what's already set for individual students.
            </Text>

            <Text style={[styles.label, { marginTop: 10 }]}>Google review link</Text>
            <TextInput
              style={styles.input}
              value={googleReviewUrl}
              onChangeText={setGoogleReviewUrl}
              placeholder="https://g.page/r/..."
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              keyboardType="url"
              testID="input-google-review-url"
            />
            <Text style={styles.hint}>
              Your Google Business Profile's "write a review" link, to share with students.
            </Text>
          </Card>

          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
            testID="btn-save-school-profile"
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save changes</Text>}
          </TouchableOpacity>

          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2, flex: 1, textAlign: 'center' },
  subtitle: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 18 },
  cardTitle: { ...theme.font.h3, marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600', color: theme.colors.text, marginTop: 4 },
  hint: { fontSize: 12, color: theme.colors.textMuted },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  logoBox: {
    width: 88, height: 88, borderRadius: 16,
    backgroundColor: theme.colors.background,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: { width: '100%', height: '100%' },
  logoCameraBadge: {
    position: 'absolute', bottom: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: theme.colors.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: theme.colors.surface,
  },
  saveBtn: {
    backgroundColor: theme.colors.primary, height: 50, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
