import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';

/**
 * Wraps an existing lesson block (passed as `children`, unchanged) with a
 * long-press-then-drag gesture. Long-press distinguishes dragging from a
 * normal tap (which still opens the lesson detail sheet) and from the
 * surrounding ScrollViews' own scroll gesture.
 *
 * This component only handles the GESTURE and the floating visual — it
 * doesn't know about time slots, days, or the backend. On release it hands
 * the raw pixel translation back to the caller via `onDrop`, which is
 * responsible for converting pixels to a new date/time, checking for a
 * collision, persisting it, and returning whether the drop was accepted.
 *
 * Why not just reset the translation to 0 immediately after a successful
 * drop? Because the parent's re-render (with the lesson's new top/left from
 * fresh data) doesn't happen in the same instant — resetting too early
 * causes a one-frame snap-back-then-jump flicker. Instead this stays
 * visually offset until `resetKey` changes (passed as a value derived from
 * the lesson's own date+start_time — so it only changes once the update
 * has actually landed), at which point the offset and the new true
 * position coincide exactly, with no flicker. A rejected drop calls back
 * with `false` and animates back to 0 immediately instead.
 */
export function DraggableLessonBlock({
  disabled,
  allowDayChange,
  resetKey,
  onDragStart,
  onDragEnd,
  onDrop,
  style,
  children,
  testID,
}: {
  disabled?: boolean;
  /** Week view: true (can cross day columns). Day view: false (time only). */
  allowDayChange?: boolean;
  resetKey: string;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDrop: (translationX: number, translationY: number) => Promise<boolean>;
  style?: any;
  children: React.ReactNode;
  testID?: string;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const isDragging = useSharedValue(false);

  // Fresh data has landed for this lesson (its date/start_time actually
  // changed) — the offset and the new true position now coincide, so drop
  // the offset to 0 with no animation (there's nothing to animate; the
  // block hasn't visually moved, only which value is "true" has changed).
  useEffect(() => {
    translateX.value = 0;
    translateY.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const handleDropAsync = (tx: number, ty: number) => {
    onDrop(tx, ty)
      .then((accepted) => {
        if (!accepted) {
          translateX.value = withSpring(0);
          translateY.value = withSpring(0);
        }
        // If accepted, leave the offset as-is — the useEffect above will
        // zero it out once `resetKey` changes from the parent's fresh data.
      })
      .catch(() => {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
      })
      .finally(() => {
        isDragging.value = false;
        onDragEnd?.();
      });
  };

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .activateAfterLongPress(350)
    .onStart(() => {
      isDragging.value = true;
      if (onDragStart) runOnJS(onDragStart)();
    })
    .onUpdate((e) => {
      translateY.value = e.translationY;
      if (allowDayChange) translateX.value = e.translationX;
    })
    .onEnd((e) => {
      const tx = allowDayChange ? e.translationX : 0;
      const ty = e.translationY;
      runOnJS(handleDropAsync)(tx, ty);
    })
    .onFinalize(() => {
      // Covers gesture cancellation (e.g. interrupted by the OS) — without
      // this, a cancelled gesture could leave isDragging stuck true and
      // the block stuck elevated above its siblings indefinitely.
      if (isDragging.value) {
        isDragging.value = false;
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
    zIndex: isDragging.value ? 50 : 2,
    elevation: isDragging.value ? 12 : 2,
    opacity: isDragging.value ? 0.92 : 1,
    shadowOpacity: isDragging.value ? 0.3 : 0,
    shadowRadius: isDragging.value ? 8 : 0,
    shadowOffset: { width: 0, height: 4 },
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[style, animatedStyle]} testID={testID}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
