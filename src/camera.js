/**
 * Camera that follows the player and reports the visible world AABB
 * so we only generate/render nearby chunks.
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});

  function createCamera(size) {
    return {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      follow: 0.15,
      /** When false, camera stays put (e.g. after minimap pan) until re-enabled. */
      followPlayer: true,
    };
  }

  function resizeCamera(camera, width, height) {
    camera.width = width;
    camera.height = height;
  }

  /** Clamp camera so the view cannot scroll past map edges. */
  function clampCameraToMap(camera, mapPixelSize) {
    mapPixelSize = mapPixelSize == null ? Wildborn.world.MAP_PIXEL_SIZE : mapPixelSize;
    if (camera.width >= mapPixelSize) {
      camera.x = (mapPixelSize - camera.width) / 2;
    } else {
      camera.x = Math.max(0, Math.min(mapPixelSize - camera.width, camera.x));
    }
    if (camera.height >= mapPixelSize) {
      camera.y = (mapPixelSize - camera.height) / 2;
    } else {
      camera.y = Math.max(0, Math.min(mapPixelSize - camera.height, camera.y));
    }
  }

  /** Smoothly center camera on the player (no-op when followPlayer is false). */
  function updateCamera(camera, target, mapPixelSize) {
    if (camera.followPlayer !== false) {
      const targetX = target.x + target.w / 2 - camera.width / 2;
      const targetY = target.y + target.h / 2 - camera.height / 2;
      camera.x += (targetX - camera.x) * camera.follow;
      camera.y += (targetY - camera.y) * camera.follow;
    }
    if (mapPixelSize != null) clampCameraToMap(camera, mapPixelSize);
  }

  /** Snap camera instantly onto target (used on new game). */
  function snapCamera(camera, target, mapPixelSize) {
    camera.x = target.x + target.w / 2 - camera.width / 2;
    camera.y = target.y + target.h / 2 - camera.height / 2;
    if (mapPixelSize != null) clampCameraToMap(camera, mapPixelSize);
  }

  /** Visible world-pixel bounds with padding for chunk preload. */
  function getVisibleBounds(camera, pad) {
    pad = pad == null ? 64 : pad;
    return {
      x0: camera.x - pad,
      y0: camera.y - pad,
      x1: camera.x + camera.width + pad,
      y1: camera.y + camera.height + pad,
    };
  }

  function worldToScreen(camera, wx, wy) {
    return { x: wx - camera.x, y: wy - camera.y };
  }

  Wildborn.camera = {
    createCamera,
    resizeCamera,
    updateCamera,
    snapCamera,
    clampCameraToMap,
    getVisibleBounds,
    worldToScreen,
  };
})(typeof window !== 'undefined' ? window : globalThis);
