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

    /** Fixed playable map size in tiles (400×400 → 25600×25600 px at 64px tiles). */
    mapTiles: 400,

    /**
     * Legacy half-extent used as a soft animal roam pad.
     * Entities are hard-clamped to the fixed map; this is map half-width.
     */
    ecosystemSpawnRadius: 200 * 64,

    /** Spatial hash cell size in world pixels (tuned for ~100 plants / ~100 animals). */
    spatialCellSize: 128,

    /**
     * Full AI + pathfinding within this distance (px) of the player focus.
     * Farther animals use cheap velocity integration most frames.
     */
    simLodNearPx: 2800,

    /** Far animals run a full AI update every N frames (1 = always). */
    simLodFarEveryN: 4,

    /** Max A-star expansions per path request (lower = cheaper, shorter max path). */
    pathfindMaxNodes: 6000,

    /** Max new A-star searches started per frame across the whole ecosystem. */
    pathfindBudgetPerFrame: 10,

    /** Seconds between minimap entity-dot redraws (terrain stays cached). */
    minimapEntityInterval: 0.2,

    /** Show ecosystem debug overlay (also toggleable with F3 in-game). */
    ecosystemDebugOverlay: false,

    /** Show species legend panel (also toggleable with L in-game). */
    showLegend: false,

    /** Show minimap of the full 400×400 grid (bottom-right). */
    showMinimap: true,

    /** Show Ecosystem Census popup (also toggleable with Tab in-game). */
    showCensus: false,

    /** Global simulation / movement speed multiplier (1 = normal, 3 = triple speed). */
    gameSpeed: 1,

    /**
     * Only tiles/entities within this Chebyshev distance (tiles) of the player
     * are drawn. Simulation continues everywhere; outside is black.
     */
    viewRadiusTiles: 30,
  };
})(typeof window !== 'undefined' ? window : globalThis);
