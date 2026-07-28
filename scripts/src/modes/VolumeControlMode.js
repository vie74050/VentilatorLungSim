import { BreathMode } from "./BreathMode.js";
import { passiveExhale } from "./passiveExhale.js";

// ---------------- VOLUME CONTROL ----------------
// You set tidal volume + rate; the vent delivers a fixed flow pattern and
// pressure is the result.
export class VolumeControlMode extends BreathMode {
  step(patient, settings, breath, DT) {
    const C = patient.effectiveCompliance(); // L/cmH2O, accounts for any collapsed lung
    const R = patient.resistance; // cmH2O/L/s
    const s = settings.VC;

    const totalCycle = 60 / s.rr;
    const Ti = totalCycle * 0.35; // I:E ~ 1:2 in real practice; simplified fixed 35% here for visual clarity
    const Te = totalCycle - Ti;
    const targetVL = s.tv / 1000;

    if (breath.phase === "insp") {
      // decelerating-ish square flow to mimic image: near-constant flow
      // producing volume ramp
      const peakFlowLs = (targetVL / Ti) * 2; // L/s, higher than mean to ramp down to zero at end of inspiration
      const frac = breath.phaseTime / Ti;
      const f = peakFlowLs * (1 - frac); // ramp down (flat) across rest of inspiration

      breath.Flow = Math.max(f, 0);
      breath.Vol += breath.Vol < targetVL ? breath.Flow * DT : 0;
      breath.Paw = s.peep + breath.Vol / C + R * breath.Flow;

      if (breath.phaseTime >= Ti) {
        breath.phase = "exp";
        breath.phaseTime = 0;
        breath.lastVTi = Math.round(breath.Vol * 1000);
        breath.expStartVol = breath.Vol; // capture once at the moment exhalation begins
      }
    } else {
      passiveExhale(C, R, s.peep, breath, Te);
    }
  }
}
