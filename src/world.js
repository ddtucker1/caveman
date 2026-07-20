/**
 * Chunked procedural tilemap.
 * Chunks generate on demand near the player (huge world, low memory).
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});
  const { createRng } = Wildborn.rng;

  /** Tile type ids */
  const TILE = {
    GRASS: 0,
    DENSE_GRASS: 1,
    TREE: 2,
    WATER: 3,
    CLIFF: 4,
    PLANT: 5,
  };

  const TILE_SIZE = 64;
  const CHUNK_SIZE = 64; // 64x64 tiles per chunk
  /** Fixed playable map: exactly 400×400 tiles → 25600×25600 pixels. */
  const MAP_TILES = 400;
  const MAP_PIXEL_SIZE = MAP_TILES * TILE_SIZE;

  /** Colors used by the renderer (simple shapes for now). */
  const TILE_COLORS = {
    [TILE.GRASS]: '#4a7a34',
    [TILE.DENSE_GRASS]: '#3d6a2c',
    [TILE.TREE]: '#2a4a1e',
    [TILE.WATER]: '#2a6a9a',
    [TILE.CLIFF]: '#6a6a62',
    [TILE.PLANT]: '#6aaa3a',
  };

  /** True if the tile blocks movement. */
  function isSolid(tile) {
    return tile === TILE.CLIFF || tile === TILE.TREE;
  }

  /** True if the tile slows movement (water). */
  function isSlow(tile) {
    return tile === TILE.WATER;
  }

  /** True if plants may spawn/grow here (green grass terrain). */
  function isGrass(tile) {
    return tile === TILE.GRASS || tile === TILE.DENSE_GRASS;
  }

  /** Land for plants/animals: any non-water, non-rock (cliff/tree) tile. */
  function isLand(tile) {
    return !isSolid(tile) && !isSlow(tile);
  }

  function inMapTile(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < MAP_TILES && ty < MAP_TILES;
  }

  function inMapPixel(px, py) {
    return px >= 0 && py >= 0 && px < MAP_PIXEL_SIZE && py < MAP_PIXEL_SIZE;
  }

  function clampPixelToMap(px, py, pad) {
    pad = pad == null ? 0 : pad;
    return {
      x: Math.max(pad, Math.min(MAP_PIXEL_SIZE - pad, px)),
      y: Math.max(pad, Math.min(MAP_PIXEL_SIZE - pad, py)),
    };
  }

  /** Smooth value noise in [0, 1] — deterministic for a given seed. */
  function valueNoise2D(x, y, seedNumeric) {
    function hash(ix, iy) {
      let n = (ix * 374761393 + iy * 668265263 + seedNumeric) | 0;
      n = (n ^ (n >>> 13)) * 1274126177;
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    }

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const a = hash(x0, y0);
    const b = hash(x0 + 1, y0);
    const c = hash(x0, y0 + 1);
    const d = hash(x0 + 1, y0 + 1);

    const top = a + (b - a) * sx;
    const bot = c + (d - c) * sx;
    return top + (bot - top) * sy;
  }

  /** Fractal Brownian motion — layered noise for biomes. */
  function fbm(x, y, seedNumeric, octaves) {
    octaves = octaves == null ? 4 : octaves;
    let value = 0;
    let amp = 0.5;
    let freq = 1;
    let totalAmp = 0;
    for (let i = 0; i < octaves; i++) {
      value += amp * valueNoise2D(x * freq, y * freq, seedNumeric + i * 1013);
      totalAmp += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return value / totalAmp;
  }

  /** Generate one chunk of tiles. */
  function generateChunk(cx, cy, worldRng) {
    const chunkRng = worldRng.derive(`chunk:${cx},${cy}`);
    const seedNum = chunkRng.seedNumeric;
    const tiles = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = cx * CHUNK_SIZE + lx;
        const wy = cy * CHUNK_SIZE + ly;

        const elev = fbm(wx * 0.02, wy * 0.02, seedNum, 4);
        const moist = fbm(wx * 0.03 + 40, wy * 0.03 + 40, seedNum + 77, 3);
        const river = fbm(wx * 0.015 + 100, wy * 0.015 + 100, seedNum + 199, 2);
        // Large rock sections: ~50% fewer than elev peaks, ~2× longer (X-stretched noise).
        const rock = fbm(wx * 0.004, wy * 0.02, seedNum + 911, 4);

        let tile = TILE.GRASS;

        if (rock > 0.72) {
          tile = TILE.CLIFF;
        } else if (river > 0.48 && river < 0.54 && elev < 0.55) {
          tile = TILE.WATER;
        } else if (moist > 0.55 && elev > 0.35 && elev < 0.65) {
          const local = valueNoise2D(wx * 0.5, wy * 0.5, seedNum + 333);
          tile = local > 0.55 ? TILE.TREE : TILE.DENSE_GRASS;
        } else {
          const local = valueNoise2D(wx * 0.8, wy * 0.8, seedNum + 555);
          if (local > 0.88) tile = TILE.PLANT;
          else if (local > 0.7) tile = TILE.DENSE_GRASS;
          else tile = TILE.GRASS;
        }

        tiles[ly * CHUNK_SIZE + lx] = tile;
      }
    }

    return { cx, cy, tiles };
  }

  /** Create the world manager (loaded chunks + tile queries). */
  function createWorld(seedString) {
    const worldRng = createRng(`${seedString}::world`);
    const chunks = new Map();

    function chunkKey(cx, cy) {
      return `${cx},${cy}`;
    }

    function ensureChunk(cx, cy) {
      const key = chunkKey(cx, cy);
      let chunk = chunks.get(key);
      if (!chunk) {
        chunk = generateChunk(cx, cy, worldRng);
        chunks.set(key, chunk);
      }
      return chunk;
    }

    /** Get tile at world tile coordinates. Generates chunk if missing. */
    function getTile(tx, ty) {
      const cx = Math.floor(tx / CHUNK_SIZE);
      const cy = Math.floor(ty / CHUNK_SIZE);
      let lx = tx - cx * CHUNK_SIZE;
      let ly = ty - cy * CHUNK_SIZE;
      if (lx < 0) lx += CHUNK_SIZE;
      if (ly < 0) ly += CHUNK_SIZE;
      const chunk = ensureChunk(cx, cy);
      return chunk.tiles[ly * CHUNK_SIZE + lx];
    }

    function getTileAtPixel(px, py) {
      const tx = Math.floor(px / TILE_SIZE);
      const ty = Math.floor(py / TILE_SIZE);
      return getTile(tx, ty);
    }

    /** Mutate a tile at world tile coordinates (used for chopping trees / breaking rock). */
    function setTile(tx, ty, tile) {
      if (!inMapTile(tx, ty)) return false;
      const cx = Math.floor(tx / CHUNK_SIZE);
      const cy = Math.floor(ty / CHUNK_SIZE);
      let lx = tx - cx * CHUNK_SIZE;
      let ly = ty - cy * CHUNK_SIZE;
      if (lx < 0) lx += CHUNK_SIZE;
      if (ly < 0) ly += CHUNK_SIZE;
      const chunk = ensureChunk(cx, cy);
      chunk.tiles[ly * CHUNK_SIZE + lx] = tile;
      return true;
    }

    /** Ensure chunks overlapping a world-pixel AABB are loaded. */
    function ensureChunksInBounds(x0, y0, x1, y1) {
      const tx0 = Math.floor(x0 / TILE_SIZE);
      const ty0 = Math.floor(y0 / TILE_SIZE);
      const tx1 = Math.floor(x1 / TILE_SIZE);
      const ty1 = Math.floor(y1 / TILE_SIZE);

      const cx0 = Math.floor(tx0 / CHUNK_SIZE);
      const cy0 = Math.floor(ty0 / CHUNK_SIZE);
      const cx1 = Math.floor(tx1 / CHUNK_SIZE);
      const cy1 = Math.floor(ty1 / CHUNK_SIZE);

      const loaded = [];
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          loaded.push(ensureChunk(cx, cy));
        }
      }
      return loaded;
    }

    /** Unload chunks farther than keepRadius from the player chunk. */
    function unloadFarChunks(playerCx, playerCy, keepRadius) {
      keepRadius = keepRadius == null ? 3 : keepRadius;
      for (const [key, chunk] of chunks) {
        const dx = chunk.cx - playerCx;
        const dy = chunk.cy - playerCy;
        if (Math.abs(dx) > keepRadius || Math.abs(dy) > keepRadius) {
          chunks.delete(key);
        }
      }
    }

    /** Preload every chunk that overlaps the fixed 400×400 map. */
    function ensureMapLoaded() {
      return ensureChunksInBounds(0, 0, MAP_PIXEL_SIZE - 1, MAP_PIXEL_SIZE - 1);
    }

    return {
      seedString,
      TILE_SIZE,
      CHUNK_SIZE,
      MAP_TILES,
      MAP_PIXEL_SIZE,
      chunks,
      getTile,
      getTileAtPixel,
      setTile,
      /** Hits remaining per harvestable tile key "tx,ty" (TREE / CLIFF). */
      tileHits: new Map(),
      ensureChunk,
      ensureChunksInBounds,
      ensureMapLoaded,
      unloadFarChunks,
      isSolid,
      isSlow,
      isGrass,
      isLand,
      inMapTile,
      inMapPixel,
      clampPixelToMap,
    };
  }

  Wildborn.world = {
    TILE,
    TILE_SIZE,
    CHUNK_SIZE,
    MAP_TILES,
    MAP_PIXEL_SIZE,
    TILE_COLORS,
    isSolid,
    isSlow,
    isGrass,
    isLand,
    inMapTile,
    inMapPixel,
    clampPixelToMap,
    createWorld,
  };
})(typeof window !== 'undefined' ? window : globalThis);
