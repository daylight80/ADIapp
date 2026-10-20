import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Search } from 'lucide-react-native';
import { theme } from './theme';
import { suggestAddresses, addressForSuggestion, worthSearching, type AddressSuggestion, type PickedAddress } from './addressLookup';

const DEBOUNCE_MS = 350;

/**
 * "Search address or postcode": type a few characters, pick a suggestion, and the address and postcode are
 * handed back. It never blocks typing by hand: if suggestions are not available the caller's own fields still work.
 */
export function AddressSearch({ onPick, testID = 'address-search' }: { onPick: (a: PickedAddress) => void; testID?: string }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!worthSearching(text)) { setItems([]); setUnavailable(false); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await suggestAddresses(text);
      if (mine !== seq.current) return; // a newer search has started
      setItems(r.suggestions);
      setUnavailable(!r.available);
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const choose = async (s: AddressSuggestion) => {
    setLoading(true);
    setError(null);
    const picked = await addressForSuggestion(s.place_id);
    setLoading(false);
    if (!picked) { setError('Could not get that address. Please type it in below.'); return; }
    seq.current += 1; // cancels any search still in flight
    setText('');
    setItems([]);
    onPick(picked);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <Search size={16} color={theme.colors.textMuted} />
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(v) => { setText(v); setError(null); }}
          placeholder="Search address or postcode"
          placeholderTextColor={theme.colors.textMuted}
          autoCorrect={false}
          testID={`${testID}-input`}
        />
        {loading && <ActivityIndicator size="small" color={theme.colors.primary} />}
      </View>
      {items.map((s) => (
        <TouchableOpacity key={s.place_id} style={styles.item} onPress={() => choose(s)} testID={`${testID}-item-${s.place_id}`}>
          <Text style={styles.itemText} numberOfLines={2}>{s.text}</Text>
        </TouchableOpacity>
      ))}
      {unavailable && worthSearching(text) && (
        <Text style={styles.note} testID={`${testID}-unavailable`}>Address search isn&apos;t available right now. Type the address below instead.</Text>
      )}
      {!!error && <Text style={[styles.note, { color: theme.colors.danger }]} testID={`${testID}-error`}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 10, paddingHorizontal: 12, backgroundColor: theme.colors.background,
  },
  input: { flex: 1, height: 44, fontSize: 15, color: theme.colors.text },
  item: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, backgroundColor: theme.colors.primaryLight },
  itemText: { fontSize: 14, color: theme.colors.text },
  note: { fontSize: 12.5, color: theme.colors.textMuted },
});
