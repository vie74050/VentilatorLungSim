/* ==========================================================================
   UNITY BRIDGE
   Owns everything specific to talking to the Unity WebGL lung visualizer:
     - tracking whether the Unity instance has finished loading
     - swapping the visible panel from the 2D SVG to the Unity canvas once ready
     - throttling how often we call SendMessage (Unity marshaling isn't free)
     - only sending when a value has changed enough to matter (send-on-change)

   This file knows NOTHING about ventilator physiology. vent-scripts.js builds
   a plain state snapshot every frame and hands it to VentUnityBridge.tick().
   Everything below just decides whether/when/how to relay that snapshot.
   ========================================================================== */

window.VentUnityBridge = (function () {
  "use strict";

  let unityInstance = null;
  let unityReady = false;

  // How often we're willing to call SendMessage, independent of sim frame rate (50Hz).
  // Morph/material lerps on the Unity side smooth between updates, so this doesn't
  // need to match the sim's step rate.
  const SEND_HZ = 18;
  const SEND_INTERVAL = 1 / SEND_HZ;
  let sendAccum = 0;

  // Minimum change required in each field before we bother sending a new payload.
  // Booleans/strings (phase, overDist, collapsed flags) always send on any flip.
  const THRESH = {
    fillFrac: 0.01,
    expGain: 0.01,
    stiffFrac: 0.01,
    rFrac: 0.01,
    alvScale: 0.01,
    bronchioleScale: 0.01,
    effort: 0.5,
    spo2: 0.5,
    paCO2: 0.5,
    shuntFrac: 0.02
  };

  // Sentinel values guarantee the first real state always counts as "changed".
  let lastSent = {
    fillFrac: -1, expGain: -1, stiffFrac: -1, rFrac: -1,
    alvScale: -1, bronchioleScale: -1, overDist: -1, phase: "",
    effort: -1, spo2: -1, paCO2: -1, shuntFrac: -1,
    leftCollapsed: -1, rightCollapsed: -1
  };

  function meaningfulChange(next) {
    if (next.phase !== lastSent.phase) return true;
    if (next.overDist !== lastSent.overDist) return true;
    if (next.leftCollapsed !== lastSent.leftCollapsed) return true;
    if (next.rightCollapsed !== lastSent.rightCollapsed) return true;
    return (
      Math.abs(next.fillFrac - lastSent.fillFrac) > THRESH.fillFrac ||
      Math.abs(next.expGain - lastSent.expGain) > THRESH.expGain ||
      Math.abs(next.stiffFrac - lastSent.stiffFrac) > THRESH.stiffFrac ||
      Math.abs(next.rFrac - lastSent.rFrac) > THRESH.rFrac ||
      Math.abs(next.alvScale - lastSent.alvScale) > THRESH.alvScale ||
      Math.abs(next.bronchioleScale - lastSent.bronchioleScale) > THRESH.bronchioleScale ||
      Math.abs(next.effort - lastSent.effort) > THRESH.effort ||
      Math.abs(next.spo2 - lastSent.spo2) > THRESH.spo2 ||
      Math.abs(next.paCO2 - lastSent.paCO2) > THRESH.paCO2 ||
      Math.abs(next.shuntFrac - lastSent.shuntFrac) > THRESH.shuntFrac
    );
  }

  function send(state, force) {
    if (!unityReady) return;

    const next = {
      fillFrac: state.fillFrac,
      expGain: state.expGain,
      stiffFrac: state.stiffFrac,
      rFrac: state.rFrac,
      alvScale: state.alvScale,
      bronchioleScale: state.bronchioleScale,
      overDist: state.overDist ? 1 : 0,
      phase: state.phase,
      effort: state.effort,
      spo2: state.spo2,
      paCO2: state.paCO2,
      shuntFrac: state.shuntFrac,
      leftCollapsed: state.leftCollapsed ? 1 : 0,
      rightCollapsed: state.rightCollapsed ? 1 : 0
    };

    if (!force && !meaningfulChange(next)) return;

    unityInstance.SendMessage("LungController", "OnSimUpdate", JSON.stringify(next));
    lastSent = next;
  }

  // Swap the visible panel: hide the SVG fallback, reveal the Unity canvas.
  // If Unity never becomes ready (load failure, unsupported WebGL), the SVG
  // is simply never hidden -- this doubles as the graceful-degradation path.
  function revealUnityPanel() {
    const svg = document.getElementById("lungSvg");
    const unityContainer = document.getElementById("unityContainer");
    if (svg) svg.style.display = "none";
    if (unityContainer) unityContainer.style.display = "";
  }

  /**
   * Called once by your Unity loader's .then() callback when the instance is ready.
   * @param {object} instance - the resolved unityInstance from createUnityInstance()
   * @param {function} [getStateFn] - optional: pass the same state-snapshot getter
   *        used in tick(), so we can immediately force-sync Unity to current sim
   *        state instead of waiting for the next natural change.
   */
  function setUnityInstance(instance, getStateFn) {
    unityInstance = instance;
    unityReady = true;
    revealUnityPanel();
    if (typeof getStateFn === "function") {
      send(getStateFn(), true); // force: bypass threshold check for this first sync
    }
  }

  function isReady() {
    return unityReady;
  }

  /**
   * Call this every sim frame from your main loop.
   * @param {number} dtWall - wall-clock seconds since last tick() call
   * @param {object} state - plain snapshot object, see README block at top of file
   *   { fillFrac, expGain, stiffFrac, rFrac, alvScale, bronchioleScale,
   *     overDist, phase, effort, spo2, paCO2, shuntFrac, leftCollapsed, rightCollapsed }
   */
  function tick(dtWall, state) {
    if (!unityReady) return;
    sendAccum += dtWall;
    if (sendAccum < SEND_INTERVAL) return;
    sendAccum -= SEND_INTERVAL;
    send(state, false);
  }

  return {
    setUnityInstance: setUnityInstance,
    isReady: isReady,
    tick: tick
  };
})();
