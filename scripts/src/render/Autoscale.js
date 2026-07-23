// ---------------- SCOPE AUTOSCALE ----------------
// Resize each waveform panel off recent breath history rather than a fixed
// range picked at ventilator-setup time. Avoids traces clipping off-panel
// for any setting combination that produces an unusually large breath
// (e.g. a high backup PC in PS mode).
const AUTOSCALE_BREATHS = 3; // rolling window, in completed breaths
const AUTOSCALE_EASE = 0.06; // per-frame ease toward target -- avoids the axis visibly snapping at each breath boundary

export class Autoscale {
  constructor() {
    this.channels = {
      paw: { floor: 15, pad: 1.1, recent: [], target: 15, display: 15 },
      flow: { floor: 100, pad: 1.1, recent: [], target: 100, display: 100 }, // symmetric +/-
      vol: { floor: 600, pad: 1.3, recent: [], target: 600, display: 600 },
    };
  }

  pushSample(kind, peakAbsValue) {
    const a = this.channels[kind];
    a.recent.push(peakAbsValue);
    if (a.recent.length > AUTOSCALE_BREATHS) a.recent.shift();
    a.target = Math.max(a.floor, Math.max(...a.recent) * a.pad);
  }

  eased(kind) {
    const a = this.channels[kind];
    a.display += (a.target - a.display) * AUTOSCALE_EASE;
    return a.display;
  }

  scaleFor(kind) {
    if (kind === "paw") return { min: -5, max: this.eased("paw") };
    if (kind === "flow") {
      const m = this.eased("flow");
      return { min: -m, max: m };
    }
    if (kind === "vol") return { min: 0, max: this.eased("vol") };
    return undefined;
  }

  scaleLabels(kind) {
    const sc = this.scaleFor(kind);
    return { top: Math.round(sc.max), bottom: Math.round(sc.min) };
  }
}
