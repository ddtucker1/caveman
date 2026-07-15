/**
 * Seeded RNG (mulberry32) + seed helpers.
 * Same seed → same sequence of numbers (shareable runs).
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});

  /** Convert a string (or number) into a 32-bit unsigned seed. */
  function hashSeed(input) {
    const str = String(input ?? '');
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h += h << 13;
    h ^= h >>> 7;
    h += h << 3;
    h ^= h >>> 17;
    h += h << 5;
    return h >>> 0;
  }

  /** Generate a random shareable seed string. */
  function randomSeedString() {
    const adjectives = ['wild', 'ancient', 'misty', 'fierce', 'lonely', 'green', 'stone', 'river'];
    const nouns = ['born', 'valley', 'pack', 'cliff', 'grove', 'marsh', 'peak', 'trail'];
    const a = adjectives[Math.floor(Math.random() * adjectives.length)];
    const n = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 9000) + 1000;
    return `${a}-${n}-${num}`;
  }

  /**
   * Create a mulberry32 PRNG from a seed string/number.
   * Returns an object with next(), float(), range(), int(), chance(), pick().
   */
  function createRng(seedInput) {
    const seedString = seedInput === '' || seedInput == null
      ? randomSeedString()
      : String(seedInput);
    let state = hashSeed(seedString);

    function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    return {
      seedString,
      seedNumeric: hashSeed(seedString),
      float: next,
      next,

      range(min, max) {
        return min + next() * (max - min);
      },

      int(min, max) {
        return Math.floor(min + next() * (max - min + 1));
      },

      chance(p) {
        return next() < p;
      },

      pick(arr) {
        return arr[Math.floor(next() * arr.length)];
      },

      /** Derive a child RNG (same parent + label → same sequence). */
      derive(label) {
        return createRng(`${seedString}::${label}`);
      },
    };
  }

  Wildborn.rng = { hashSeed, randomSeedString, createRng };
})(typeof window !== 'undefined' ? window : globalThis);
