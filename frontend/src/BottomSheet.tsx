import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, useWindowDimensions } from 'react-native';
import { theme } from './theme';
import { X } from 'lucide-react-native';
import { useKeyboardHeight, sheetBodyMaxHeight } from './useKeyboardHeight';

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  testID?: string;
};

export function BottomSheet({ visible, onClose, title, children, testID }: Props) {
  // On Android the keyboard would sit on top of the sheet, so the sheet is lifted above it and its
  // scrolling body is shortened to fit. The focused field is then scrolled into view by the body.
  const keyboardHeight = useKeyboardHeight();
  const { height: windowHeight } = useWindowDimensions();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID={testID}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} testID="bottom-sheet-backdrop" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[styles.sheetWrap, keyboardHeight > 0 && { marginBottom: keyboardHeight }]}
        >
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              {title ? <Text style={styles.title}>{title}</Text> : <View />}
              <TouchableOpacity onPress={onClose} testID="bottom-sheet-close">
                <X size={22} color={theme.colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={{ maxHeight: sheetBodyMaxHeight(windowHeight, keyboardHeight) }}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
            >
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end', alignItems: 'center' },
  backdropTouch: { ...StyleSheet.absoluteFillObject },
  // maxWidth only matters on wide viewports (web/tablet) — on a real phone
  // screen (< 480px wide) this never kicks in, so width:'100%' still fills
  // the screen exactly as before. On a desktop browser it stops the sheet
  // stretching edge-to-edge across the whole window.
  sheetWrap: { width: '100%', maxWidth: 480 },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 4,
    backgroundColor: theme.colors.border,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 8,
  },
  title: { ...theme.font.h3 },
});
