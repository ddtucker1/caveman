/**
 * Runtime feature flags and tuning knobs.
 * Toggle ecosystem off for performance / isolation testing.
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});

  Wildborn.config = {
    /** Master switch — when false, EcosystemManager is not created or updated. */
    ecosystemEnabled: true,

    /** Seconds of real time per discrete ecosystem tick (hunger, growth, age). */
    ecosystemTickSeconds: 0.5,

    /** World-pixel half-extent used when scattering the initial population. */
    ecosystemSpawnRadius: 48 * 32, // ~48 tiles

    /** Spatial hash cell size in world pixels. */
    spatialCellSize: 96,

    /** Show ecosystem debug overlay (also toggleable with F3 in-game). */
    ecosystemDebugOverlay: false,
  };
})(typeof window !== 'undefined' ? window : globalThis);
