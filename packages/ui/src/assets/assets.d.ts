/** Image imports resolve to their URL (Vite in the apps, Vitest in tests). */
declare module '*.png' {
  const src: string;
  export default src;
}
