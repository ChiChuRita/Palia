// `expo start` generates expo-env.d.ts with this same reference, but that
// file is gitignored — so `tsc` on a fresh checkout (CI) loses the ambient
// declarations for CSS imports ("@/global.css", "*.module.css") and fails.
// Committing the reference here keeps `npm run typecheck` green everywhere.
/// <reference types="expo/types" />
