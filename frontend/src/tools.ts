import { Platform, Linking, Alert } from 'react-native';

export type NavApp = 'google' | 'waze' | 'apple';

function buildNavUrl(app: NavApp, address: string): string {
  const q = encodeURIComponent(address);
  switch (app) {
    case 'google':
      return Platform.OS === 'ios'
        ? `comgooglemaps://?daddr=${q}&directionsmode=driving`
        : `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
    case 'waze':
      return `https://waze.com/ul?q=${q}&navigate=yes`;
    case 'apple':
      return `http://maps.apple.com/?daddr=${q}&dirflg=d`;
  }
}

export async function openNavigation(app: NavApp, address: string): Promise<boolean> {
  if (!address) {
    Alert.alert('No address', 'This student has no pickup address on file.');
    return false;
  }
  const url = buildNavUrl(app, address);
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        window.open(url, '_blank');
        return true;
      }
    }
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
      return true;
    }
    // Fallback to web Google Maps
    await Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`);
    return true;
  } catch {
    return false;
  }
}

export async function openSmsComposer(phone: string, body: string): Promise<boolean> {
  const sep = Platform.OS === 'ios' ? '&' : '?';
  const url = `sms:${phone}${sep}body=${encodeURIComponent(body)}`;
  try {
    if (Platform.OS === 'web') {
      // On web preview: copy to clipboard fallback
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(`To: ${phone}\n\n${body}`);
        Alert.alert('Message copied', `Phone & message copied to clipboard (web preview).`);
        return true;
      }
      return false;
    }
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    return ok;
  } catch {
    return false;
  }
}

/** wa.me wants the number in international form with no "+": 07496 496582 -> 447496496582. */
export function whatsAppUrl(phone: string, body: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `44${digits.slice(1)}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
}

/** Opens WhatsApp with the message already written; the sender still taps Send. */
export async function openWhatsApp(phone: string, body: string): Promise<boolean> {
  const url = whatsAppUrl(phone, body);
  try {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return false;
      window.open(url, '_blank');
      return true;
    }
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export function copyToClipboard(text: string): boolean {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      return true;
    }
    // expo-clipboard would be ideal; fallback alert
    return false;
  } catch {
    return false;
  }
}
