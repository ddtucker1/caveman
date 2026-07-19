/**
 * Canvas 2D shape renderer for ecosystem entities.
 * All species draw through renderShape() using data from shapes.js / shapes.json.
 * Keep draw calls low: simple geometric primitives only.
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});

  /**
   * Primary entry used by all entity sprites.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} entityType species id
   * @param {number} x screen x (center)
   * @param {number} y screen y (center)
   * @param {number} scale visual scale (1 = species default size)
   * @param {boolean} facingRight
   * @param {object} [opts]
   */
  function renderShape(ctx, entityType, x, y, scale, facingRight, opts) {
    opts = opts || {};
    let def = Wildborn.shapes.getSpeciesDef(entityType);
    if (!def) {
      // Fallback square so missing defs stay visible
      const s = 8 * (scale || 1);
      ctx.fillStyle = '#888';
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      return;
    }

    // Hunger-search: eye dots turn orange
    if (opts.hungrySearch && def.category !== 'plant') {
      def = Object.assign({}, def, {
        eyeColor: '#ff8c00',
        eyeGlowColor: '#ff8c00',
      });
    }

    const sz = (def.size || 10) * (scale || 1);
    const time = opts.time != null ? opts.time : 0;
    const state = opts.state || 'IDLE';
    const calories = opts.calories != null ? opts.calories : def.size;
    const maxCalories = opts.maxCalories != null ? opts.maxCalories : def.size;
    const calRatio = maxCalories > 0 ? Math.max(0, Math.min(1, calories / maxCalories)) : 1;

    ctx.save();
    ctx.translate(x, y);

    // Shadow stays upright/grounded even when the corpse is flipped
    drawShadow(ctx, sz, def.category === 'plant' ? 0.55 : 0.65);

    // Death: flip upside down, fade out over ~3s
    if (state === 'DEAD') {
      const deadAge = opts.deadAge != null ? opts.deadAge : 0;
      const fade = Math.max(0, 1 - deadAge / 3);
      ctx.globalAlpha *= 0.25 + 0.45 * fade;
      ctx.rotate(Math.PI);
    }

    // Facing
    if (!facingRight) ctx.scale(-1, 1);

    // Sleep: lie on side (tilt toward π/2)
    if ((state === 'SLEEP' || opts.sleeping) && state !== 'DEAD') {
      const tilt = opts.sleepTilt != null ? opts.sleepTilt : Math.PI / 2;
      ctx.rotate(facingRight ? tilt : -tilt);
    }

    // Sleep: dim to ~80% brightness
    if ((state === 'SLEEP' || opts.sleeping) && state !== 'DEAD') {
      ctx.globalAlpha *= 0.8;
    }

    // Shared animation transforms
    const anim = computeAnim(opts, time, state, entityType);
    ctx.translate(anim.ox, anim.oy);
    ctx.scale(anim.sx, anim.sy);
    if (anim.rot) ctx.rotate(anim.rot);

    // Hunt glow (wolf)
    if (opts.hunting && def.features && def.features.indexOf('hunt_glow') >= 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(200,40,40,0.55)';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(220,40,40,0.7)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.ellipse(0, 0, sz * 0.55, sz * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (def.category === 'plant') {
      drawPlant(ctx, entityType, def, sz, calRatio, calories, maxCalories, time);
    } else if (def.category === 'herbivore') {
      drawHerbivore(ctx, entityType, def, sz, opts, time, anim);
    } else if (def.category === 'predator') {
      drawPredator(ctx, entityType, def, sz, opts, time, anim);
    }

    // Corpse gray wash: draw muted overlay silhouette only (local, no filter)
    if (state === 'DEAD') {
      ctx.fillStyle = 'rgba(90, 80, 70, 0.45)';
      ctx.beginPath();
      ctx.ellipse(0, 0, sz * 0.5, sz * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Calorie bar (plants always; animals always when alive)
    if (state !== 'DEAD') {
      if (def.category === 'plant') {
        drawCalorieBar(ctx, x, y, sz, calRatio);
      } else if (def.category === 'herbivore' || def.category === 'predator') {
        drawCalorieBar(ctx, x, y, sz, calRatio);
      }
    }

    // Aggro / status icons (screen space)
    if (def.category === 'predator' && state !== 'DEAD') {
      if (opts.roaring) {
        ctx.fillStyle = '#e05040';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!', x, y - sz * 0.85);
        ctx.textAlign = 'start';
      }
    }

    // Zzz particles (sleep) — screen space
    if ((state === 'SLEEP' || opts.sleeping) && state !== 'DEAD') {
      drawZzzParticles(ctx, x, y - sz * 0.5, opts.zzzParticles, time);
    }

    // Locked-in eating indicator — small yellow dot above head
    if (opts.eatLocked && (state === 'EATING' || opts.eating) && state !== 'DEAD') {
      ctx.fillStyle = '#f0d030';
      ctx.beginPath();
      ctx.arc(x, y - sz * 0.78, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(80, 60, 0, 0.55)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // Flee motion lines (screen space, behind facing)
    if (opts.fleeing && state !== 'DEAD') {
      drawMotionLines(ctx, x, y, facingRight, sz);
    }
  }

  // ---------------------------------------------------------------------------
  // Animation helpers
  // ---------------------------------------------------------------------------

  function computeAnim(opts, time, state, entityType) {
    const idPhase = (opts.id || 0) * 0.37;
    const t = time + idPhase;
    let ox = 0;
    let oy = 0;
    let sx = 1;
    let sy = 1;
    let rot = 0;
    let headDip = 0;

    const moving = !!opts.moving;
    const speed = opts.speed || 0;

    if (state === 'DEAD') {
      // Soft settle into the ground as corpse ages
      const deadAge = opts.deadAge != null ? opts.deadAge : 0;
      oy = Math.min(2.5, deadAge * 0.4);
      return { ox: 0, oy: oy, sx: 1.05, sy: 0.92, rot: 0, headDip: 0 };
    }

    // Idle breathing 1.0 → 1.025 over ~2s
    if (!moving && (state === 'IDLE' || state === 'SLEEP' || state === 'ROAM')) {
      const breath = 1 + 0.025 * Math.sin((t / 2) * Math.PI * 2);
      sx = breath;
      sy = 2 - breath;
    }

    // Gentle plant idle sway / bob / leaf rustle (higher quality)
    if (opts._isPlant || state === 'IDLE') {
      const cat = Wildborn.shapes.getCategory(entityType);
      if (cat === 'plant') {
        const sway = Math.sin(t * 1.05) * 0.055;
        const bob = Math.sin(t * 1.55 + 0.4) * 1.1;
        const rustle = Math.sin(t * 2.6 + idPhase) * 0.018;
        const gust = Math.sin(t * 0.35 + idPhase * 0.5) * 0.02;
        rot = sway + rustle + gust;
        oy = bob;
        sx = 1 + Math.sin(t * 1.25) * 0.02;
        sy = 1 - Math.sin(t * 1.25) * 0.014;
      }
    }

    // Walk bob + leg stride phase for animals
    if (moving && state !== 'EATING' && state !== 'SLEEP') {
      const stride = Math.min(2.8, 1.1 + speed * 0.012);
      oy = Math.sin(t * 7.5 + speed * 0.05) * stride;
      sx *= 1 + Math.sin(t * 15) * 0.015;
      opts._walkPhase = t * 8;
    } else {
      opts._walkPhase = opts._walkPhase || 0;
    }

    // Eating head bob toward plant — once per second
    if (state === 'EATING' || opts.eating) {
      const phase =
        opts.eatBobPhase != null ? opts.eatBobPhase : t - Math.floor(t);
      const bob =
        phase < 0.35 ? Math.sin((phase / 0.35) * Math.PI) : 0;
      headDip = bob * 7;
      oy += headDip * 0.45;
      rot = 0.22 * bob;

      if (opts.eatLocked) {
        const lockPhase =
          opts.eatLockPhase != null ? opts.eatLockPhase : t % 3;
        if (lockPhase < 0.35) {
          rot += Math.sin((lockPhase / 0.35) * Math.PI * 4) * 0.25;
        }
      }
    }

    // Flee lean forward
    if ((state === 'FLEE' || opts.fleeing) && state !== 'SLEEP') {
      rot = opts.counterAttack ? -0.18 : 0.22;
      oy -= 1;
    }

    // Bear rear-up
    if (opts.rearUp) {
      sy *= 1.18;
      sx *= 0.88;
      oy -= 5;
    }

    // Exhausted pant
    if (opts.panting) {
      const pant = Math.sin(t * Math.PI * 6);
      opts._jawOpen = 0.35 + 0.55 * (0.5 + 0.5 * pant);
      sx *= 1 + 0.045 * pant;
      sy *= 1 - 0.035 * pant;
    }

    // Rabbit ear twitch
    opts._earTwitch = Math.sin(t * 5.5) > 0.9 ? -2.2 : 0;
    if (!opts.panting) {
      opts._jawOpen =
        state === 'EATING'
          ? 0.5 + 0.5 * Math.sin(t * 12)
          : opts.hunting
            ? 0.75
            : 0.12;
    }

    return { ox: ox, oy: oy, sx: sx, sy: sy, rot: rot, headDip: headDip };
  }

  function drawShadow(ctx, sz, ryScale) {
    const shared = Wildborn.shapes.getShapeDefs().shared;
    ctx.fillStyle = shared.shadowColor;
    ctx.beginPath();
    ctx.ellipse(0, sz * 0.42, sz * 0.45, sz * 0.18 * (ryScale || 0.65), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCalorieBar(ctx, x, y, sz, ratio) {
    const bar = Wildborn.shapes.getShapeDefs().shared.calorieBar;
    const w = bar.width;
    const h = bar.height;
    const bx = x - w / 2;
    const by = y - sz * 0.55 + bar.offsetY;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(bx, by, w, h);
    let color = '#5aaa3a';
    if (ratio < 0.33) color = '#c05040';
    else if (ratio < 0.66) color = '#d4b84a';
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, w * Math.max(0, Math.min(1, ratio)), h);
  }

  function drawMotionLines(ctx, x, y, facingRight, sz) {
    const dir = facingRight ? -1 : 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const lx = x + dir * (sz * 0.55 + i * 3);
      const ly = y - 2 + i * 2;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + dir * 4, ly - 1);
      ctx.stroke();
    }
  }

  function drawZzz(ctx, x, y, time) {
    const phase = (time % 2) / 2;
    ctx.fillStyle = 'rgba(200,200,220,0.75)';
    ctx.font = '10px sans-serif';
    ctx.fillText('z', x + 4, y - phase * 10);
    ctx.font = '8px sans-serif';
    ctx.fillText('z', x + 10, y - 6 - phase * 8);
  }

  /** Draw managed Zzz particles (1/sec, fade over 2s). */
  function drawZzzParticles(ctx, x, y, particles, time) {
    if (!particles || !particles.length) {
      drawZzz(ctx, x, y, time || 0);
      return;
    }
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < particles.length; i++) {
      const z = particles[i];
      const alpha = Math.max(0, Math.min(1, z.life / (z.maxLife || 2)));
      ctx.fillStyle = 'rgba(200,200,220,' + (0.85 * alpha) + ')';
      ctx.fillText('z', x + z.x, y + z.y);
    }
    ctx.textAlign = 'start';
  }

  function drawEye(ctx, ex, ey, color, lookX, lookY, radius) {
    const lx = Math.max(-0.8, Math.min(0.8, lookX || 0));
    const ly = Math.max(-0.8, Math.min(0.8, lookY || 0));
    const r = radius != null ? radius : 1.8;
    // White/sclera for light eyes; solid for dark
    const isDark = color === '#1a1008' || color === '#2a2018' || color === '#1a1a1e';
    if (!isDark) {
      ctx.fillStyle = '#f4f0e8';
      ctx.beginPath();
      ctx.arc(ex, ey, r * 1.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = color || '#2a2018';
    ctx.beginPath();
    ctx.arc(ex + lx * r * 0.35, ey + ly * r * 0.35, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(ex + lx * r * 0.35 - r * 0.3, ey + ly * r * 0.35 - r * 0.3, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawAnimatedLegs(ctx, kind, sz, color, walkPhase, moving) {
    ctx.strokeStyle = color || '#5a4030';
    ctx.lineCap = 'round';
    ctx.lineWidth =
      kind === 'long_thin' || kind === 'very_long' || kind === 'two_thin'
        ? Math.max(1.6, sz * 0.045)
        : Math.max(2.2, sz * 0.07);
    const y0 = sz * 0.25;
    const len =
      kind === 'very_long'
        ? sz * 0.58
        : kind === 'long_thin'
          ? sz * 0.42
          : kind === 'medium'
            ? sz * 0.3
            : sz * 0.22;
    const xs =
      kind === 'two_thin' || kind === 'very_long'
        ? [-sz * 0.12, sz * 0.12]
        : [-sz * 0.26, -sz * 0.1, sz * 0.08, sz * 0.24];
    const phase = walkPhase || 0;
    for (let i = 0; i < xs.length; i++) {
      const swing = moving ? Math.sin(phase + i * 1.6) * sz * 0.08 : 0;
      ctx.beginPath();
      ctx.moveTo(xs[i], y0);
      ctx.lineTo(xs[i] + swing + (i % 2 === 0 ? -0.8 : 0.8), y0 + len);
      ctx.stroke();
      // Small hoof/paw
      ctx.fillStyle = color || '#5a4030';
      ctx.beginPath();
      ctx.ellipse(
        xs[i] + swing,
        y0 + len + 1,
        Math.max(1.4, sz * 0.045),
        Math.max(0.9, sz * 0.025),
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------------------
  // Plants
  // ---------------------------------------------------------------------------

  function drawPlant(ctx, type, def, sz, calRatio, calories, maxCalories, time) {
    if (type === 'berry_bush') drawBerryBush(ctx, def, sz, calories, time);
    else if (type === 'grass') drawGrassPlant(ctx, def, sz, calRatio, time);
    else if (type === 'mushroom') drawMushroom(ctx, def, sz, calRatio, time);
    else if (type === 'fruit_tree') drawFruitTree(ctx, def, sz, calories, time);
    else if (type === 'cactus') drawCactus(ctx, def, sz, calRatio, calories, maxCalories, time);
  }

  function drawBerryBush(ctx, def, sz, calories, time) {
    const n = def.clusterCount || 7;
    const leafDark = def.leafDark || '#1e5a1e';
    const leafColor = def.leafColor || def.baseColor;
    // Under-foliage shadow
    ctx.fillStyle = leafDark;
    ctx.beginPath();
    ctx.ellipse(0, sz * 0.14, sz * 0.48, sz * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.baseColor;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.2;
      const r = sz * 0.3;
      const wobble = time != null ? Math.sin(time * 1.5 + i) * 0.7 : 0;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.52 - 3 + wobble * 0.2, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Center canopy highlight
    const g = ctx.createRadialGradient(-sz * 0.08, -sz * 0.12, 1, 0, -2, sz * 0.4);
    g.addColorStop(0, leafColor);
    g.addColorStop(1, def.baseColor);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, -3, sz * 0.36, 0, Math.PI * 2);
    ctx.fill();

    if (calories > (def.berryCalorieThreshold || 1)) {
      const berry = def.berryColor || def.accentColor;
      const hi = def.berryHighlight || '#e07090';
      const berries = [
        [-5, -6], [6, -3], [-3, 4], [4, -8], [1, -1], [-6, 2], [5, 3], [-1, -4], [3, 5],
      ];
      for (let i = 0; i < berries.length; i++) {
        const bx = berries[i][0] * (sz / 40);
        const by = berries[i][1] * (sz / 40);
        ctx.fillStyle = berry;
        ctx.beginPath();
        ctx.arc(bx, by, Math.max(2, sz * 0.065), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hi;
        ctx.beginPath();
        ctx.arc(bx - 0.9, by - 0.9, Math.max(0.7, sz * 0.022), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawGrassPlant(ctx, def, sz, calRatio, time) {
    const h = sz * (0.55 + calRatio * 1.05);
    const color = calRatio < 0.25 ? def.depletedColor : def.baseColor;
    const dark = calRatio < 0.25 ? '#6a5030' : def.darkColor;
    const tip = def.tipColor || color;
    const blades = 7;
    for (let i = 0; i < blades; i++) {
      const bx = -sz * 0.42 + i * (sz * 0.14);
      const lean = (i - (blades - 1) / 2) * 1.8;
      const sway = time != null ? Math.sin((time || 0) * 2.1 + i * 0.65) * 2.2 : 0;
      const tipX = bx + lean + sway;
      const grad = ctx.createLinearGradient(bx, h * 0.3, tipX, -h * 0.55);
      grad.addColorStop(0, dark);
      grad.addColorStop(0.6, color);
      grad.addColorStop(1, tip);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.8 + (i % 2) * 0.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bx, sz * 0.4);
      ctx.quadraticCurveTo(bx + lean * 0.5, -h * 0.05, tipX, -h * 0.52);
      ctx.stroke();
    }
  }

  function drawMushroom(ctx, def, sz, calRatio, time) {
    const bob = time != null ? Math.sin(time * 1.8) * 0.4 : 0;
    // Stem with highlight
    ctx.fillStyle = def.stemColor;
    ctx.fillRect(-sz * 0.09, -1 + bob, sz * 0.18, sz * 0.48);
    ctx.fillStyle = def.stemHighlight || '#a88868';
    ctx.fillRect(-sz * 0.04, -1 + bob, sz * 0.06, sz * 0.48);
    // Cap
    ctx.fillStyle = calRatio > 0.5 ? def.capColor : def.capColorAlt;
    ctx.beginPath();
    ctx.ellipse(0, -sz * 0.18 + bob, sz * 0.46, sz * 0.3, 0, Math.PI, 0);
    ctx.fill();
    // Cap underside rim
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.ellipse(0, -sz * 0.16 + bob, sz * 0.44, sz * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    if (calRatio > 0.55) {
      ctx.fillStyle = def.spotColor;
      const spots = [
        [-sz * 0.18, -sz * 0.28],
        [sz * 0.16, -sz * 0.22],
        [0, -sz * 0.34],
        [sz * 0.08, -sz * 0.14],
      ];
      for (let i = 0; i < spots.length; i++) {
        ctx.beginPath();
        ctx.arc(spots[i][0], spots[i][1] + bob, 1.1 + (i % 2) * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawFruitTree(ctx, def, sz, calories, time) {
    // Trunk with bark highlight
    ctx.fillStyle = def.trunkColor;
    ctx.fillRect(-sz * 0.08, -sz * 0.05, sz * 0.16, sz * 0.52);
    ctx.fillStyle = def.trunkHighlight || '#8a6038';
    ctx.fillRect(-sz * 0.02, -sz * 0.05, sz * 0.05, sz * 0.52);
    // Canopy layers
    ctx.fillStyle = def.canopyColor;
    ctx.beginPath();
    ctx.arc(-sz * 0.24, -sz * 0.28, sz * 0.3, 0, Math.PI * 2);
    ctx.arc(sz * 0.24, -sz * 0.24, sz * 0.28, 0, Math.PI * 2);
    ctx.arc(0, -sz * 0.44, sz * 0.32, 0, Math.PI * 2);
    ctx.arc(-sz * 0.1, -sz * 0.18, sz * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.canopyLight || '#3a8a2e';
    ctx.beginPath();
    ctx.arc(sz * 0.08, -sz * 0.4, sz * 0.18, 0, Math.PI * 2);
    ctx.arc(-sz * 0.16, -sz * 0.32, sz * 0.14, 0, Math.PI * 2);
    ctx.fill();
    if (calories > (def.fruitCalorieThreshold || 1)) {
      const fruit = def.fruitColor;
      const hi = def.fruitHighlight || '#f0a050';
      const fruits = [
        [-sz * 0.18, -sz * 0.2],
        [sz * 0.2, -sz * 0.28],
        [0, -sz * 0.42],
        [sz * 0.12, -sz * 0.12],
        [-sz * 0.08, -sz * 0.3],
        [sz * 0.28, -sz * 0.16],
      ];
      for (let i = 0; i < fruits.length; i++) {
        const sway = time != null ? Math.sin(time * 1.4 + i) * 0.4 : 0;
        ctx.fillStyle = fruit;
        ctx.beginPath();
        ctx.arc(fruits[i][0] + sway * 0.2, fruits[i][1], Math.max(1.6, sz * 0.055), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hi;
        ctx.beginPath();
        ctx.arc(fruits[i][0] - 0.7, fruits[i][1] - 0.7, Math.max(0.5, sz * 0.02), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawCactus(ctx, def, sz, calRatio, calories, maxCalories, time) {
    const bob = time != null ? Math.sin(time * 1.2) * 0.3 : 0;
    ctx.fillStyle = def.baseColor;
    // Body
    ctx.beginPath();
    ctx.ellipse(0, bob, sz * 0.28, sz * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.baseLight || '#3a8a4a';
    ctx.beginPath();
    ctx.ellipse(sz * 0.06, bob, sz * 0.1, sz * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    // Arms
    ctx.fillStyle = def.baseColor;
    ctx.beginPath();
    ctx.ellipse(-sz * 0.34, -sz * 0.05 + bob, sz * 0.15, sz * 0.22, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(sz * 0.32, -sz * 0.14 + bob, sz * 0.13, sz * 0.2, 0.35, 0, Math.PI * 2);
    ctx.fill();
    // Ridges
    ctx.strokeStyle = def.ridgeColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -sz * 0.38 + bob);
    ctx.lineTo(0, sz * 0.38 + bob);
    ctx.stroke();
    // Spines
    ctx.strokeStyle = def.spineColor || '#d8d0b8';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 4; i++) {
      const y = -sz * 0.25 + i * sz * 0.16 + bob;
      ctx.beginPath();
      ctx.moveTo(sz * 0.2, y);
      ctx.lineTo(sz * 0.32, y - 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-sz * 0.2, y + 2);
      ctx.lineTo(-sz * 0.32, y + 1);
      ctx.stroke();
    }
    // Flower at full calories
    if (calories >= maxCalories) {
      ctx.fillStyle = def.flowerColor;
      ctx.beginPath();
      ctx.arc(0, -sz * 0.52 + bob, Math.max(2.2, sz * 0.08), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f0d060';
      ctx.beginPath();
      ctx.arc(0, -sz * 0.52 + bob, Math.max(0.8, sz * 0.03), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------------------
  // Herbivores
  // ---------------------------------------------------------------------------

  function drawHerbivore(ctx, type, def, sz, opts, time, anim) {
    const lookX = opts.lookX || 0;
    const lookY = opts.lookY || 0;
    const headY = opts.eating || opts.state === 'EATING' ? 2.5 : 0;
    opts._moving = !!opts.moving;
    opts._walkPhase = opts._walkPhase || 0;

    if (type === 'rabbit') drawRabbit(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'deer') drawDeer(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'bison') drawBison(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'ostrich') drawOstrich(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'turtle') drawTurtle(ctx, def, sz, opts, lookX, lookY, headY);
  }

  function drawLegs(ctx, kind, sz, color) {
    drawAnimatedLegs(ctx, kind, sz, color, 0, false);
  }

  function drawRabbit(ctx, def, sz, opts, lookX, lookY, headY) {
    drawAnimatedLegs(ctx, 'short', sz, def.bodyShade || def.bodyColor, opts._walkPhase, opts._moving);
    // Soft underbelly
    ctx.fillStyle = def.tailColor || '#f8f4ec';
    ctx.beginPath();
    ctx.ellipse(sz * 0.02, headY + sz * 0.1, sz * 0.32, sz * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    // Body with shading
    const bodyGrad = ctx.createRadialGradient(-sz * 0.1, headY - sz * 0.1, 1, 0, headY, sz * 0.45);
    bodyGrad.addColorStop(0, def.bodyColor);
    bodyGrad.addColorStop(1, def.bodyShade || '#b89870');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, headY, sz * 0.44, sz * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.3, headY - sz * 0.1, sz * 0.24, sz * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // Cheek fluff
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.ellipse(sz * 0.38, headY - sz * 0.02, sz * 0.1, sz * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ears with pink inner
    const twitch = opts._earTwitch || 0;
    ctx.fillStyle = def.earColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.22, headY - sz * 0.44 + twitch, sz * 0.09, sz * 0.3, -0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(sz * 0.36, headY - sz * 0.42 + twitch * 0.5, sz * 0.08, sz * 0.28, 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.earInner || '#e8b8b0';
    ctx.beginPath();
    ctx.ellipse(sz * 0.22, headY - sz * 0.44 + twitch, sz * 0.04, sz * 0.2, -0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(sz * 0.36, headY - sz * 0.42 + twitch * 0.5, sz * 0.035, sz * 0.18, 0.12, 0, Math.PI * 2);
    ctx.fill();
    // Cotton tail with highlight
    ctx.fillStyle = def.tailColor;
    ctx.beginPath();
    ctx.arc(-sz * 0.4, headY + sz * 0.04, sz * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-sz * 0.42, headY, sz * 0.05, 0, Math.PI * 2);
    ctx.fill();
    // Nose
    ctx.fillStyle = def.noseColor || '#c07070';
    ctx.beginPath();
    ctx.ellipse(sz * 0.48, headY - sz * 0.06, sz * 0.04, sz * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
    drawEye(ctx, sz * 0.38, headY - sz * 0.14, def.eyeColor, lookX, lookY, Math.max(1.6, sz * 0.055));
  }

  function drawDeer(ctx, def, sz, opts, lookX, lookY, headY) {
    drawAnimatedLegs(ctx, 'long_thin', sz, def.bodyShade || def.bodyColor, opts._walkPhase, opts._moving);
    // Belly
    ctx.fillStyle = def.bellyColor || '#e8d4a8';
    ctx.beginPath();
    ctx.ellipse(0, headY + sz * 0.1, sz * 0.4, sz * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    // Graceful body
    const g = ctx.createLinearGradient(0, headY - sz * 0.25, 0, headY + sz * 0.25);
    g.addColorStop(0, def.bodyColor);
    g.addColorStop(1, def.bodyShade || '#a88848');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, headY, sz * 0.5, sz * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Neck
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.36, headY - sz * 0.2, sz * 0.14, sz * 0.24, 0.35, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.beginPath();
    ctx.ellipse(sz * 0.48, headY - sz * 0.28, sz * 0.16, sz * 0.14, 0.15, 0, Math.PI * 2);
    ctx.fill();
    // Ears
    ctx.fillStyle = def.earColor;
    ctx.beginPath();
    ctx.moveTo(sz * 0.4, headY - sz * 0.38);
    ctx.lineTo(sz * 0.36, headY - sz * 0.54);
    ctx.lineTo(sz * 0.48, headY - sz * 0.4);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sz * 0.5, headY - sz * 0.38);
    ctx.lineTo(sz * 0.54, headY - sz * 0.52);
    ctx.lineTo(sz * 0.58, headY - sz * 0.36);
    ctx.fill();
    // Antlers on males
    if (opts.sex === 'male' && opts.isAdult !== false) {
      ctx.strokeStyle = def.antlerColor;
      ctx.lineWidth = Math.max(1.8, sz * 0.045);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sz * 0.42, headY - sz * 0.4);
      ctx.lineTo(sz * 0.38, headY - sz * 0.62);
      ctx.lineTo(sz * 0.28, headY - sz * 0.55);
      ctx.moveTo(sz * 0.38, headY - sz * 0.62);
      ctx.lineTo(sz * 0.42, headY - sz * 0.7);
      ctx.moveTo(sz * 0.52, headY - sz * 0.4);
      ctx.lineTo(sz * 0.56, headY - sz * 0.6);
      ctx.lineTo(sz * 0.64, headY - sz * 0.52);
      ctx.moveTo(sz * 0.56, headY - sz * 0.6);
      ctx.lineTo(sz * 0.58, headY - sz * 0.68);
      ctx.stroke();
    }
    // Tail tuft
    ctx.fillStyle = def.bellyColor || '#e8d4a8';
    ctx.beginPath();
    ctx.ellipse(-sz * 0.5, headY - sz * 0.02, sz * 0.08, sz * 0.12, 0.3, 0, Math.PI * 2);
    ctx.fill();
    // Nose
    ctx.fillStyle = def.noseColor || '#3a2818';
    ctx.beginPath();
    ctx.ellipse(sz * 0.6, headY - sz * 0.24, sz * 0.035, sz * 0.025, 0, 0, Math.PI * 2);
    ctx.fill();
    drawEye(ctx, sz * 0.52, headY - sz * 0.3, def.eyeColor, lookX, lookY, Math.max(1.7, sz * 0.04));
  }

  function drawBison(ctx, def, sz, opts, lookX, lookY, headY) {
    drawAnimatedLegs(ctx, 'short_thick', sz, def.bodyShade || def.bodyColor, opts._walkPhase, opts._moving);
    // Massive shaggy body
    ctx.fillStyle = def.bodyColor;
    roundRect(ctx, -sz * 0.5, headY - sz * 0.22, sz * 0.98, sz * 0.52, 6);
    ctx.fill();
    // Fur texture strokes
    ctx.strokeStyle = def.furHighlight || '#5a4030';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      const fx = -sz * 0.35 + i * sz * 0.12;
      ctx.beginPath();
      ctx.moveTo(fx, headY - sz * 0.05);
      ctx.lineTo(fx + 1, headY + sz * 0.18);
      ctx.stroke();
    }
    // Shoulder hump
    ctx.fillStyle = def.humpColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.02, headY - sz * 0.3, sz * 0.32, sz * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.furHighlight || '#5a4030';
    ctx.beginPath();
    ctx.ellipse(sz * 0.08, headY - sz * 0.34, sz * 0.14, sz * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    // Broad head with beard
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.44, headY - sz * 0.02, sz * 0.24, sz * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.humpColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.48, headY + sz * 0.12, sz * 0.14, sz * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    // Curved horns
    ctx.strokeStyle = def.hornColor;
    ctx.lineWidth = Math.max(2.2, sz * 0.05);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sz * 0.34, headY - sz * 0.16);
    ctx.quadraticCurveTo(sz * 0.28, headY - sz * 0.36, sz * 0.38, headY - sz * 0.32);
    ctx.moveTo(sz * 0.52, headY - sz * 0.16);
    ctx.quadraticCurveTo(sz * 0.58, headY - sz * 0.36, sz * 0.5, headY - sz * 0.32);
    ctx.stroke();
    // Bushy tail
    ctx.fillStyle = def.humpColor;
    ctx.beginPath();
    ctx.ellipse(-sz * 0.52, headY + sz * 0.05, sz * 0.1, sz * 0.16, 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.noseColor || '#1a1008';
    ctx.beginPath();
    ctx.ellipse(sz * 0.62, headY + sz * 0.02, sz * 0.05, sz * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    drawEye(ctx, sz * 0.5, headY - sz * 0.1, def.eyeColor, lookX, lookY, Math.max(1.8, sz * 0.035));
  }

  function drawOstrich(ctx, def, sz, opts, lookX, lookY, headY) {
    // Very long legs with knee joint
    ctx.strokeStyle = def.legColor;
    ctx.lineWidth = Math.max(2, sz * 0.05);
    ctx.lineCap = 'round';
    const walk = opts._moving ? Math.sin(opts._walkPhase || 0) * sz * 0.1 : 0;
    ctx.beginPath();
    ctx.moveTo(-sz * 0.08, sz * 0.08);
    ctx.lineTo(-sz * 0.1 + walk, sz * 0.38);
    ctx.lineTo(-sz * 0.14 + walk, sz * 0.68);
    ctx.moveTo(sz * 0.1, sz * 0.08);
    ctx.lineTo(sz * 0.12 - walk, sz * 0.38);
    ctx.lineTo(sz * 0.16 - walk, sz * 0.68);
    ctx.stroke();
    // Feet
    ctx.lineWidth = Math.max(1.5, sz * 0.035);
    ctx.beginPath();
    ctx.moveTo(-sz * 0.14 + walk, sz * 0.68);
    ctx.lineTo(-sz * 0.22 + walk, sz * 0.72);
    ctx.moveTo(sz * 0.16 - walk, sz * 0.68);
    ctx.lineTo(sz * 0.24 - walk, sz * 0.72);
    ctx.stroke();
    // Round dark body
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, headY, sz * 0.38, sz * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.bodyShade || '#0e0e0e';
    ctx.beginPath();
    ctx.ellipse(-sz * 0.05, headY + sz * 0.05, sz * 0.22, sz * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // White wing tips
    ctx.fillStyle = def.wingColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.08, headY + sz * 0.04, sz * 0.2, sz * 0.12, 0.25, 0, Math.PI * 2);
    ctx.fill();
    // Feather fan tail
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.moveTo(-sz * 0.32, headY);
    ctx.quadraticCurveTo(-sz * 0.62, headY - sz * 0.28, -sz * 0.55, headY + sz * 0.05);
    ctx.quadraticCurveTo(-sz * 0.6, headY + sz * 0.22, -sz * 0.32, headY + sz * 0.1);
    ctx.fill();
    ctx.fillStyle = def.wingColor;
    ctx.beginPath();
    ctx.moveTo(-sz * 0.4, headY - sz * 0.05);
    ctx.lineTo(-sz * 0.58, headY - sz * 0.18);
    ctx.lineTo(-sz * 0.48, headY + sz * 0.02);
    ctx.fill();
    // Long S-curve neck
    ctx.strokeStyle = def.neckColor;
    ctx.lineWidth = Math.max(2.8, sz * 0.07);
    ctx.beginPath();
    ctx.moveTo(sz * 0.18, headY - sz * 0.12);
    ctx.bezierCurveTo(
      sz * 0.28,
      headY - sz * 0.35,
      sz * 0.22,
      headY - sz * 0.55,
      sz * 0.34,
      headY - sz * 0.72
    );
    ctx.stroke();
    // Small head + beak
    ctx.fillStyle = def.neckColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.4, headY - sz * 0.74, sz * 0.11, sz * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.beakColor || '#c89040';
    ctx.beginPath();
    ctx.moveTo(sz * 0.48, headY - sz * 0.74);
    ctx.lineTo(sz * 0.62, headY - sz * 0.72);
    ctx.lineTo(sz * 0.48, headY - sz * 0.68);
    ctx.fill();
    drawEye(ctx, sz * 0.42, headY - sz * 0.76, def.eyeColor, lookX, lookY, Math.max(1.5, sz * 0.035));
  }

  function drawTurtle(ctx, def, sz, opts, lookX, lookY, headY) {
    // Webbed/short legs
    ctx.fillStyle = def.bodyShade || def.bodyColor;
    const walk = opts._moving ? Math.sin(opts._walkPhase || 0) * sz * 0.04 : 0;
    const feet = [
      [-sz * 0.32 + walk, sz * 0.22],
      [sz * 0.26 - walk, sz * 0.22],
      [-sz * 0.3 - walk, -sz * 0.06],
      [sz * 0.24 + walk, -sz * 0.06],
    ];
    for (let i = 0; i < feet.length; i++) {
      ctx.beginPath();
      ctx.ellipse(feet[i][0], headY + feet[i][1], sz * 0.12, sz * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Shell dome with highlight
    const shellGrad = ctx.createRadialGradient(-sz * 0.1, headY - sz * 0.15, 2, 0, headY, sz * 0.5);
    shellGrad.addColorStop(0, def.shellLight || '#4e8a4e');
    shellGrad.addColorStop(1, def.shellColor);
    ctx.fillStyle = shellGrad;
    ctx.beginPath();
    ctx.ellipse(0, headY, sz * 0.48, sz * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    // Hex / scute pattern
    ctx.strokeStyle = def.shellLineColor;
    ctx.lineWidth = Math.max(1.2, sz * 0.035);
    const scutes = [
      [0, -sz * 0.08, sz * 0.14],
      [-sz * 0.22, 0, sz * 0.12],
      [sz * 0.22, 0, sz * 0.12],
      [-sz * 0.12, sz * 0.14, sz * 0.1],
      [sz * 0.12, sz * 0.14, sz * 0.1],
    ];
    for (let i = 0; i < scutes.length; i++) {
      ctx.beginPath();
      for (let a = 0; a < 6; a++) {
        const ang = (a / 6) * Math.PI * 2 - Math.PI / 2;
        const px = scutes[i][0] + Math.cos(ang) * scutes[i][2];
        const py = headY + scutes[i][1] + Math.sin(ang) * scutes[i][2] * 0.75;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
    // Head
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.46, headY - sz * 0.02, sz * 0.16, sz * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    // Stubby tail
    ctx.beginPath();
    ctx.ellipse(-sz * 0.48, headY + 2, sz * 0.09, sz * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
    drawEye(ctx, sz * 0.54, headY - sz * 0.05, def.eyeColor, lookX, lookY, Math.max(1.5, sz * 0.04));
  }

  // ---------------------------------------------------------------------------
  // Predators
  // ---------------------------------------------------------------------------

  function drawPredator(ctx, type, def, sz, opts, time, anim) {
    const lookX = opts.lookX || 0;
    const lookY = opts.lookY || 0;
    const headY = opts.eating || opts.state === 'EATING' ? 2.8 : 0;
    opts._moving = !!opts.moving;
    opts._walkPhase = opts._walkPhase || 0;

    if (type === 'wolf') drawWolf(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'bear') drawBear(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'alligator') drawAlligator(ctx, def, sz, opts, lookX, lookY, headY);
  }

  function drawWolf(ctx, def, sz, opts, lookX, lookY, headY) {
    drawAnimatedLegs(ctx, 'medium', sz, def.bodyShade || def.bodyColor, opts._walkPhase, opts._moving);
    // Bushy tail
    ctx.fillStyle = def.tailColor;
    ctx.beginPath();
    ctx.ellipse(-sz * 0.5, headY - sz * 0.08, sz * 0.2, sz * 0.12, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.bodyShade || '#6a6a74';
    ctx.beginPath();
    ctx.ellipse(-sz * 0.55, headY - sz * 0.04, sz * 0.1, sz * 0.07, 0.5, 0, Math.PI * 2);
    ctx.fill();
    // Lean body + lighter belly
    ctx.fillStyle = def.bellyColor || '#c8c4c0';
    ctx.beginPath();
    ctx.ellipse(sz * 0.02, headY + sz * 0.1, sz * 0.36, sz * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, headY, sz * 0.48, sz * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    // Shoulder fur tuft
    ctx.fillStyle = def.bodyShade || '#6a6a74';
    ctx.beginPath();
    ctx.ellipse(sz * 0.12, headY - sz * 0.16, sz * 0.16, sz * 0.1, -0.2, 0, Math.PI * 2);
    ctx.fill();
    // Head / snout
    ctx.fillStyle = def.snoutColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.36, headY - sz * 0.1, sz * 0.22, sz * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sz * 0.48, headY - sz * 0.06);
    ctx.lineTo(sz * 0.7, headY);
    ctx.lineTo(sz * 0.48, headY + sz * 0.1);
    ctx.fill();
    // Nose
    ctx.fillStyle = def.noseColor || '#1a1a1e';
    ctx.beginPath();
    ctx.ellipse(sz * 0.7, headY, sz * 0.04, sz * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
    // Teeth when hunting
    if (opts.hunting || opts._jawOpen > 0.5) {
      ctx.fillStyle = def.toothColor;
      const open = (opts._jawOpen || 0.5) * sz * 0.04;
      ctx.fillRect(sz * 0.54, headY + 1, Math.max(1.5, sz * 0.035), 2.5 + open);
      ctx.fillRect(sz * 0.62, headY + 1, Math.max(1.5, sz * 0.035), 2 + open);
    }
    // Pointed ears with pink inner
    ctx.fillStyle = def.earColor;
    ctx.beginPath();
    ctx.moveTo(sz * 0.22, headY - sz * 0.22);
    ctx.lineTo(sz * 0.16, headY - sz * 0.46);
    ctx.lineTo(sz * 0.34, headY - sz * 0.24);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sz * 0.36, headY - sz * 0.22);
    ctx.lineTo(sz * 0.4, headY - sz * 0.44);
    ctx.lineTo(sz * 0.48, headY - sz * 0.2);
    ctx.fill();
    ctx.fillStyle = def.earInner || '#c08080';
    ctx.beginPath();
    ctx.moveTo(sz * 0.24, headY - sz * 0.26);
    ctx.lineTo(sz * 0.2, headY - sz * 0.4);
    ctx.lineTo(sz * 0.3, headY - sz * 0.26);
    ctx.fill();
    drawEye(ctx, sz * 0.4, headY - sz * 0.16, def.eyeColor, lookX, lookY, Math.max(1.7, sz * 0.04));
  }

  function drawBear(ctx, def, sz, opts, lookX, lookY, headY) {
    if (!opts.rearUp) {
      drawAnimatedLegs(ctx, 'short_thick', sz, def.bodyShade || def.bodyColor, opts._walkPhase, opts._moving);
    } else {
      ctx.strokeStyle = def.bodyColor;
      ctx.lineWidth = Math.max(3, sz * 0.07);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-sz * 0.1, sz * 0.15);
      ctx.lineTo(-sz * 0.12, sz * 0.48);
      ctx.moveTo(sz * 0.1, sz * 0.15);
      ctx.lineTo(sz * 0.12, sz * 0.48);
      ctx.stroke();
      // Raised paws
      ctx.beginPath();
      ctx.moveTo(-sz * 0.28, -sz * 0.05);
      ctx.lineTo(-sz * 0.4, -sz * 0.28);
      ctx.moveTo(sz * 0.28, -sz * 0.05);
      ctx.lineTo(sz * 0.4, -sz * 0.28);
      ctx.stroke();
    }
    // Bulky grizzly body
    ctx.fillStyle = def.bodyColor;
    roundRect(ctx, -sz * 0.48, headY - sz * 0.32, sz * 0.94, sz * 0.58, 7);
    ctx.fill();
    // Shoulder hump / fur highlight
    ctx.fillStyle = def.furHighlight || '#6a4830';
    ctx.beginPath();
    ctx.ellipse(sz * 0.05, headY - sz * 0.3, sz * 0.28, sz * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    // Fur texture
    ctx.strokeStyle = 'rgba(30,16,8,0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(-sz * 0.3 + i * sz * 0.14, headY);
      ctx.lineTo(-sz * 0.28 + i * sz * 0.14, headY + sz * 0.18);
      ctx.stroke();
    }
    // Head
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.4, headY - sz * 0.1, sz * 0.24, sz * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // Snout patch
    ctx.fillStyle = def.snoutColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.56, headY, sz * 0.14, sz * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.noseColor || '#1a1008';
    ctx.beginPath();
    ctx.ellipse(sz * 0.66, headY + sz * 0.02, sz * 0.045, sz * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    // Rounded ears
    ctx.fillStyle = def.earColor;
    ctx.beginPath();
    ctx.arc(sz * 0.28, headY - sz * 0.32, sz * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sz * 0.44, headY - sz * 0.32, sz * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.snoutColor;
    ctx.beginPath();
    ctx.arc(sz * 0.28, headY - sz * 0.32, sz * 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sz * 0.44, headY - sz * 0.32, sz * 0.045, 0, Math.PI * 2);
    ctx.fill();
    // Stubby tail
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.arc(-sz * 0.48, headY + sz * 0.05, sz * 0.09, 0, Math.PI * 2);
    ctx.fill();
    if (opts.eating || opts.state === 'EATING') {
      ctx.fillStyle = '#2a1810';
      const open = (opts._jawOpen || 0) * 4;
      ctx.fillRect(sz * 0.52, headY + 3 + open * 0.3, 7, 2 + open);
    }
    drawEye(ctx, sz * 0.42, headY - sz * 0.16, def.eyeColor, lookX, lookY, Math.max(1.8, sz * 0.035));
  }

  function drawAlligator(ctx, def, sz, opts, lookX, lookY, headY) {
    // Thick tapering tail with ridges
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.moveTo(-sz * 0.28, headY - sz * 0.04);
    ctx.quadraticCurveTo(-sz * 0.7, headY - sz * 0.02, -sz * 0.95, headY + sz * 0.06);
    ctx.quadraticCurveTo(-sz * 0.7, headY + sz * 0.16, -sz * 0.28, headY + sz * 0.18);
    ctx.fill();
    // Tail scutes
    ctx.fillStyle = def.scaleColor || '#3a6a3a';
    for (let i = 0; i < 4; i++) {
      const tx = -sz * 0.4 - i * sz * 0.12;
      ctx.beginPath();
      ctx.moveTo(tx, headY - sz * 0.02);
      ctx.lineTo(tx - sz * 0.04, headY - sz * 0.1);
      ctx.lineTo(tx + sz * 0.04, headY - sz * 0.02);
      ctx.fill();
    }
    // Long flat body
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, headY + 1, sz * 0.52, sz * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // Scale rows
    ctx.strokeStyle = def.bodyShade || '#1a3e1a';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.ellipse(-sz * 0.15 + i * sz * 0.12, headY - sz * 0.02, sz * 0.05, sz * 0.04, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Belly
    ctx.fillStyle = def.bellyColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.05, headY + sz * 0.08, sz * 0.32, sz * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    // Short legs
    ctx.fillStyle = def.bodyShade || def.bodyColor;
    const feet = [
      [-sz * 0.2, sz * 0.2],
      [sz * 0.15, sz * 0.2],
      [-sz * 0.05, sz * 0.18],
      [sz * 0.28, sz * 0.18],
    ];
    for (let i = 0; i < feet.length; i++) {
      ctx.beginPath();
      ctx.ellipse(feet[i][0], headY + feet[i][1], sz * 0.1, sz * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Long snout + open jaw
    const jaw = opts._jawOpen != null ? opts._jawOpen : 0.3;
    ctx.fillStyle = def.jawColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.48, headY - jaw * sz * 0.08, sz * 0.32, sz * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.48, headY + jaw * sz * 0.12, sz * 0.32, sz * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    // Teeth
    ctx.fillStyle = def.toothColor || '#f0ece4';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(sz * 0.4 + i * sz * 0.08, headY, Math.max(1.5, sz * 0.025), Math.max(2, sz * 0.04));
    }
    // Raised eye ridge
    ctx.fillStyle = def.scaleColor || '#3a6a3a';
    ctx.beginPath();
    ctx.ellipse(sz * 0.28, headY - sz * 0.12, sz * 0.08, sz * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    drawEye(ctx, sz * 0.3, headY - sz * 0.14, def.eyeColor, lookX, lookY, Math.max(1.6, sz * 0.035));
    // Water ripple when in water
    if (opts.inWater) {
      ctx.strokeStyle = 'rgba(180,220,255,0.4)';
      ctx.lineWidth = 1.4;
      const r = sz * 0.6 + ((opts.time || 0) % 1.5) * 6;
      ctx.beginPath();
      ctx.ellipse(0, sz * 0.28, r, r * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Draw a tiny legend icon (for L-panel / tooltips).
   */
  function renderLegendIcon(ctx, entityType, x, y, iconScale) {
    iconScale = iconScale || 0.55;
    renderShape(ctx, entityType, x, y, iconScale, true, {
      time: 0,
      state: 'IDLE',
      calories: 999,
      maxCalories: 999,
      isAdult: true,
      sex: 'male',
    });
  }

  Wildborn.renderShapes = {
    renderShape,
    renderLegendIcon,
    computeAnim,
  };
})(typeof window !== 'undefined' ? window : globalThis);
