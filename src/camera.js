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
    };
  }

  function resizeCamera(camera, width, height) {
    camera.width = width;
    camera.height = height;
  }

  /** Smoothly center camera on the player. */
  function updateCamera(camera, target) {
    const targetX = target.x + target.w / 2 - camera.width / 2;
    const targetY = target.y + target.h / 2 - camera.height / 2;
    camera.x += (targetX - camera.x) * camera.follow;
    camera.y += (targetY - camera.y) * camera.follow;
  }

  /** Snap camera instantly onto target (used on new game). */
  function snapCamera(camera, target) {
    camera.x = target.x + target.w / 2 - camera.width / 2;
    camera.y = target.y + target.h / 2 - camera.height / 2;
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
    getVisibleBounds,
    worldToScreen,
  };
})(typeof window !== 'undefined' ? window : globalThis);
