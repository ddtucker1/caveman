/**
 * Runtime feature flags and tuning knobs.
 * Toggle ecosystem off for performance / isolation testing.
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});

  Wildborn.config = {
    /** Master switch — when false, EcosystemManager is not created or updated. */
    ecosystemEnabled: true,

    /** Seconds of real time per discrete ecosystem tick (hunger, growth, reproduction). */
    ecosystemTickSeconds: 0.5,

    /** Fixed playable map size in tiles (400×400 → 12800×12800 px at 32px tiles). */
    mapTiles: 400,

    /**
     * Legacy half-extent used as a soft animal roam pad.
     * Entities are hard-clamped to the fixed map; this is map half-width.
     */
    ecosystemSpawnRadius: 200 * 32,

    /** Spatial hash cell size in world pixels (tuned for ~150 plants / ~100 animals). */
    spatialCellSize: 64,

    /** Show ecosystem debug overlay (also toggleable with F3 in-game). */
    ecosystemDebugOverlay: false,

    /** Show species legend panel (also toggleable with L in-game). */
    showLegend: false,

    /** Show minimap of the full 400×400 grid (bottom-right). */
    showMinimap: true,

    /** Show Ecosystem Census popup (also toggleable with Tab in-game). */
    showCensus: false,
  };
})(typeof window !== 'undefined' ? window : globalThis);
