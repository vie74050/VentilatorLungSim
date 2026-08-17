// ---------------- BREATH STATE ----------------
// The instantaneous, per-tick signals produced by whichever BreathMode is
// currently stepping, plus the last-completed-breath readouts derived from
// them. This is the single mutable object every BreathMode.step()
// receives and updates -- it plays the same role the loose module-scope
// `Paw/Flow/Vol/phase/...` variables played in the original script.
export class BreathState {
  constructor() {
    this.phase = "insp"; // insp | exp
    this.phaseTime = 0;

    this.Paw = 0; // cmH2O
    this.Flow = 0; // L/s
    this.Vol = 0; // L

    // captured exactly once at the insp->exp transition: the starting
    // volume for this breath's exhale decay
    this.expStartVol = 0;

    this.lastVTe = 0;
    this.lastVTi = 0;
    this.lastPpeak = 0;
    this.lastRRdisplay = 16;
  }

  // Called on mode switch: resets the active breath cycle for a clean
  // transition, but deliberately leaves lastPpeak/lastRRdisplay alone
  // (matches original switchMode behavior -- those readouts persist until
  // the next completed breath overwrites them).
  resetForModeSwitch() {
    this.phase = "insp";
    this.phaseTime = 0;
    this.Vol = 0;
    this.expStartVol = 0;
    this.lastVTe = 0;
    this.lastVTi = 0;
  }
}
