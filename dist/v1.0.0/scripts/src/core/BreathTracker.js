// ---------------- BREATH TRACKER ----------------
// Watches the ventilator's breath phase each tick and detects insp/exp
// boundaries. We track Ppeak per-breath separately and reset cleanly.
// Peak |flow| spans a full breath cycle (both the inspiratory push and the
// expiratory decay peak right after insp ends), so it's accumulated
// unconditionally each tick and finalized at the *next* breath's start
// rather than gated to a single phase like breathPpeak is.
//
// onExpStart / onInspStart are injected callbacks rather than direct calls
// into GasExchangeModel / Autoscale -- keeps this class decoupled from
// those modules; VentSimApp wires the callbacks together.
export class BreathTracker {
  constructor({ onExpStart = () => {}, onInspStart = () => {} } = {}) {
    this.breathPpeak = 0;
    this.breathPeakFlowAbs = 0;
    this.prevPhase = "insp";
    this.lastBreathTimes = [];
    this.onExpStart = onExpStart;
    this.onInspStart = onInspStart;
  }

  // Called alongside Ventilator.switchMode() so a mode change gives a
  // clean breath-tracking slate too (matches original switchMode, which
  // reset these same fields inline).
  reset() {
    this.breathPpeak = 0;
    this.breathPeakFlowAbs = 0;
    this.lastBreathTimes = [];
  }

  update(ventilator) {
    const { breath, simTime } = ventilator;

    if (breath.phase === "insp") {
      this.breathPpeak = Math.max(this.breathPpeak, breath.Paw);
    }
    this.breathPeakFlowAbs = Math.max(
      this.breathPeakFlowAbs,
      Math.abs(breath.Flow * 60), // L/min, matches the flow panel's units
    );

    const expStarted = this.prevPhase === "insp" && breath.phase === "exp";
    const inspStarted = this.prevPhase === "exp" && breath.phase === "insp";

    if (expStarted) {
      breath.lastPpeak = this.breathPpeak;
      this.breathPpeak = 0;
      this.onExpStart(breath.lastPpeak, breath.lastVTi);
    }

    if (inspStarted) {
      this.onInspStart(this.breathPeakFlowAbs);
      this.breathPeakFlowAbs = 0;

      this.lastBreathTimes.push(simTime);
      if (this.lastBreathTimes.length > 6) this.lastBreathTimes.shift();
      if (this.lastBreathTimes.length >= 2) {
        const intervals = [];
        for (let i = 1; i < this.lastBreathTimes.length; i++)
          intervals.push(this.lastBreathTimes[i] - this.lastBreathTimes[i - 1]);
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        breath.lastRRdisplay = Math.round(60 / avg);
      }
    }

    this.prevPhase = breath.phase;
  }
}
