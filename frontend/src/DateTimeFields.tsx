// Native + Web cross-platform Date and Time pickers.
//   • On iOS / Android: tap the field → opens @react-native-community/datetimepicker
//     in modal mode. iOS gets the spinner UI, Android gets the native dialog.
//   • On Web: renders a real HTML <input type="date" /> or type="time" so the
//     browser's native calendar / clock UI surfaces.
//
// Both fields use the same controlled-string contract so existing form state
// keeps working:
//     DateField  value="YYYY-MM-DD"  onChange(string)
//     TimeField  value="HH:mm"       onChange(string)

import React, { useState } from 'react';
import { Platform, TouchableOpacity, View, Text, StyleSheet, Modal } from 'react-native';
import { Calendar, Clock } from 'lucide-react-native';
import { theme } from './theme';

// Native picker is imported lazily (web bundle should not pull it in)
let DateTimePicker: any = null;
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  DateTimePicker = require('@react-native-community/datetimepicker').default;
}

const pad = (n: number) => String(n).padStart(2, '0');

function toLocalDateString(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toLocalTimeString(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function parseDateString(s: string): Date {
  if (!s) return new Date();
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}
function parseTimeString(s: string): Date {
  const d = new Date();
  const [hh, mm] = (s || '00:00').split(':').map(Number);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
}

type FieldProps = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testID?: string;
};

function FieldShell({
  iconNode,
  text,
  placeholder,
  onPress,
  testID,
  webInput,
}: {
  iconNode: React.ReactNode;
  text: string;
  placeholder?: string;
  onPress?: () => void;
  testID?: string;
  webInput?: React.ReactNode;
}) {
  return (
    <View style={styles.field} testID={testID}>
      <View style={styles.fieldIcon}>{iconNode}</View>
      {Platform.OS === 'web' ? (
        <View style={styles.fieldInputWrap}>{webInput}</View>
      ) : (
        <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.fieldInputWrap}>
          <Text style={[styles.fieldText, !text && styles.fieldPlaceholder]}>
            {text || placeholder || ''}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function DateField({ value, onChange, placeholder = 'YYYY-MM-DD', testID }: FieldProps) {
  const [open, setOpen] = useState(false);

  if (Platform.OS === 'web') {
    // Render a real HTML input via the createElement escape hatch for RN-Web.
    const input = React.createElement('input' as any, {
      type: 'date',
      value: value || '',
      placeholder,
      onChange: (e: any) => onChange(e.target.value),
      style: {
        border: 'none',
        outline: 'none',
        fontSize: 16,
        background: 'transparent',
        color: theme.colors.text,
        width: '100%',
        height: 44,
        fontFamily: 'inherit',
      },
    });
    return (
      <FieldShell
        iconNode={<Calendar size={18} color={theme.colors.textMuted} />}
        text={value}
        placeholder={placeholder}
        testID={testID}
        webInput={input}
      />
    );
  }

  return (
    <>
      <FieldShell
        iconNode={<Calendar size={18} color={theme.colors.textMuted} />}
        text={value}
        placeholder={placeholder}
        onPress={() => setOpen(true)}
        testID={testID}
      />
      {open && DateTimePicker && (
        <PickerHost
          mode="date"
          value={parseDateString(value)}
          onClose={() => setOpen(false)}
          onChange={(d) => {
            onChange(toLocalDateString(d));
          }}
        />
      )}
    </>
  );
}

export function TimeField({ value, onChange, placeholder = 'HH:mm', testID }: FieldProps) {
  const [open, setOpen] = useState(false);

  if (Platform.OS === 'web') {
    const input = React.createElement('input' as any, {
      type: 'time',
      value: value || '',
      placeholder,
      step: 300, // 5-min granularity
      onChange: (e: any) => onChange(e.target.value),
      style: {
        border: 'none',
        outline: 'none',
        fontSize: 16,
        background: 'transparent',
        color: theme.colors.text,
        width: '100%',
        height: 44,
        fontFamily: 'inherit',
      },
    });
    return (
      <FieldShell
        iconNode={<Clock size={18} color={theme.colors.textMuted} />}
        text={value}
        placeholder={placeholder}
        testID={testID}
        webInput={input}
      />
    );
  }

  return (
    <>
      <FieldShell
        iconNode={<Clock size={18} color={theme.colors.textMuted} />}
        text={value}
        placeholder={placeholder}
        onPress={() => setOpen(true)}
        testID={testID}
      />
      {open && DateTimePicker && (
        <PickerHost
          mode="time"
          value={parseTimeString(value)}
          onClose={() => setOpen(false)}
          onChange={(d) => onChange(toLocalTimeString(d))}
        />
      )}
    </>
  );
}

// ---- Native picker host (modal-style) ---------------------------------------
function PickerHost({
  mode,
  value,
  onChange,
  onClose,
}: {
  mode: 'date' | 'time';
  value: Date;
  onChange: (d: Date) => void;
  onClose: () => void;
}) {
  // Android's native dialog auto-closes — emit + close immediately.
  if (Platform.OS === 'android') {
    return (
      <DateTimePicker
        value={value}
        mode={mode}
        is24Hour
        display="default"
        onChange={(_e: any, d?: Date) => {
          onClose();
          if (d) onChange(d);
        }}
      />
    );
  }

  // iOS: present as a bottom-sheet modal with Cancel / Done buttons.
  const [draft, setDraft] = useState<Date>(value);
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} testID="picker-cancel">
              <Text style={[styles.modalAction, { color: theme.colors.textMuted }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{mode === 'date' ? 'Select date' : 'Select time'}</Text>
            <TouchableOpacity
              onPress={() => {
                onChange(draft);
                onClose();
              }}
              testID="picker-done"
            >
              <Text style={[styles.modalAction, { color: theme.colors.primary }]}>Done</Text>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={draft}
            mode={mode}
            is24Hour
            display="spinner"
            minuteInterval={5}
            onChange={(_e: any, d?: Date) => d && setDraft(d)}
            textColor={theme.colors.text}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 12,
    backgroundColor: theme.colors.background,
    gap: 8,
  },
  fieldIcon: { width: 22, alignItems: 'center' },
  fieldInputWrap: { flex: 1 },
  fieldText: { fontSize: 16, color: theme.colors.text },
  fieldPlaceholder: { color: theme.colors.textMuted },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modalTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  modalAction: { fontSize: 15, fontWeight: '700' },
});
