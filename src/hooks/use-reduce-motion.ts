import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Returns true when the user has enabled Reduce Motion in iOS Accessibility.
 * Decorative animations (idle breath, score reveal, etc.) should be gated by
 * this. State-conveying animations (color transitions, layout) should still
 * run because they carry information.
 */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => {
      if (mounted) setReduced(v);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
