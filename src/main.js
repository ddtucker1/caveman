/**
 * Wildborn — main entry.
 * Phase 1: menu → seeded world → player movement → camera → render loop.
 */
(function () {
  const { createRng, randomSeedString } = Wildborn.rng;
  const { createWorld, TILE_SIZE, CHUNK_SIZE } = Wildborn.world;
  const { createPlayer, updatePlayer, findSpawn } = Wildborn.player;
  const {
    createCamera,
    updateCamera,
    snapCamera,
    getVisibleBounds,
  } = Wildborn.camera;
  const {
    clear,
    drawWorld,
    drawPlayer,
    updateHud,
    setSeedDisplay,
    drawDebug,
  } = Wildborn.render;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  /** @type {'menu' | 'playing'} */
  let state = 'menu';

  const game = {
    seedString: '',
    rng: null,
    world: null,
    player: null,
    camera: null,
    keys: { up: false, down: false, left: false, right: false },
    lastTime: 0,
    fps: 0,
    fpsAccum: 0,
    fpsFrames: 0,
  };

  // ---------------------------------------------------------------------------
  // Canvas sizing (CSS pixels via setTransform)
  // ---------------------------------------------------------------------------

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (game.camera) {
      game.camera.width = window.innerWidth;
      game.camera.height = window.innerHeight;
    }
  }

  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  const KEY_MAP = {
    KeyW: 'up', ArrowUp: 'up',
    KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
  };

  window.addEventListener('keydown', function (e) {
    const dir = KEY_MAP[e.code];
    if (dir) {
      game.keys[dir] = true;
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', function (e) {
    const dir = KEY_MAP[e.code];
    if (dir) {
      game.keys[dir] = false;
      e.preventDefault();
    }
  });

  // ---------------------------------------------------------------------------
  // Menu
  // ---------------------------------------------------------------------------

  const menuEl = document.getElementById('menu');
  const seedInput = document.getElementById('seed-input');
  const btnStart = document.getElementById('btn-start');
  const btnRandom = document.getElementById('btn-random');

  btnRandom.addEventListener('click', function () {
    seedInput.value = randomSeedString();
  });

  btnStart.addEventListener('click', function () {
    const seed = seedInput.value.trim() || randomSeedString();
    startGame(seed);
  });

  seedInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') btnStart.click();
  });

  seedInput.value = randomSeedString();

  // ---------------------------------------------------------------------------
  // Game start / loop
  // ---------------------------------------------------------------------------

  function startGame(seedString) {
    game.seedString = seedString;
    game.rng = createRng(seedString);
    game.world = createWorld(seedString);
    game.camera = createCamera({
      width: window.innerWidth,
      height: window.innerHeight,
    });

    game.world.ensureChunksInBounds(
      -TILE_SIZE * 8,
      -TILE_SIZE * 8,
      TILE_SIZE * 8,
      TILE_SIZE * 8
    );
    const spawn = findSpawn(game.world);
    game.player = createPlayer(spawn);

    snapCamera(game.camera, game.player);
    setSeedDisplay(seedString);
    updateHud(game.player);

    menuEl.classList.add('hidden');
    state = 'playing';
    game.lastTime = performance.now();
  }

  function update(dt) {
    const step = Math.min(dt, 0.05);

    updatePlayer(game.player, game.keys, step, game.world);
    updateCamera(game.camera, game.player);

    const bounds = getVisibleBounds(game.camera, TILE_SIZE * 2);
    game.world.ensureChunksInBounds(bounds.x0, bounds.y0, bounds.x1, bounds.y1);

    const playerCx = Math.floor(game.player.x / TILE_SIZE / CHUNK_SIZE);
    const playerCy = Math.floor(game.player.y / TILE_SIZE / CHUNK_SIZE);
    game.world.unloadFarChunks(playerCx, playerCy, 3);

    updateHud(game.player);
  }

  function render() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    clear(ctx, w, h);
    drawWorld(ctx, game.world, game.camera);
    drawPlayer(ctx, game.player, game.camera);

    const playerTx = Math.floor(game.player.x / TILE_SIZE);
    const playerTy = Math.floor(game.player.y / TILE_SIZE);
    drawDebug(ctx, {
      fps: game.fps,
      chunkCount: game.world.chunks.size,
      playerTx: playerTx,
      playerTy: playerTy,
    });
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (state !== 'playing') return;

    const dt = (now - game.lastTime) / 1000;
    game.lastTime = now;

    game.fpsAccum += dt;
    game.fpsFrames += 1;
    if (game.fpsAccum >= 0.5) {
      game.fps = Math.round(game.fpsFrames / game.fpsAccum);
      game.fpsAccum = 0;
      game.fpsFrames = 0;
    }

    update(dt);
    render();
  }

  requestAnimationFrame(frame);

  // Console access for Phase 1 verification
  window.__wildborn = game;
})();
