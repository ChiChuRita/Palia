import { forwardRef } from "react";
import { Pressable, type PressableProps, type View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/use-reduce-motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Gentle press feedback for cards, rows, and buttons. ME/CFS-aware: a small,
// soft scale + dim on press — no bounce, no spring overshoot, nothing that
// flickers or demands attention. Reduce-motion drops the scale entirely and
// keeps only a quiet opacity dip. `scaleTo` lets big targets (the orb) settle
// on a subtler ratio than small rows.
export const PressableScale = forwardRef<View, PressableProps & { scaleTo?: number }>(
  function PressableScale({ scaleTo = 0.97, style, onPressIn, onPressOut, ...rest }, ref) {
    const reduceMotion = useReduceMotion();
    const pressed = useSharedValue(0);

    const animatedStyle = useAnimatedStyle(() => {
      const p = pressed.value;
      return {
        opacity: 1 - p * 0.15,
        transform: [{ scale: reduceMotion ? 1 : 1 - p * (1 - scaleTo) }],
      };
    });

    return (
      <AnimatedPressable
        ref={ref}
        style={[style, animatedStyle]}
        onPressIn={(e) => {
          pressed.value = withTiming(1, { duration: 110, easing: Easing.out(Easing.quad) });
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          pressed.value = withTiming(0, { duration: 190, easing: Easing.out(Easing.quad) });
          onPressOut?.(e);
        }}
        {...rest}
      />
    );
  }
);
