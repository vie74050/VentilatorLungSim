import { BreathMode } from "./BreathMode.js";
import { passiveExhale } from "./passiveExhale.js";

// ---------------- PRESSURE SUPPORT / CPAP ----------------
// The patient triggers each breath; the vent only supports it with a fixed
// pressure boost.
//
// Patient-triggered breaths get a modest assist pressure (PS) -- the
// patient is doing most of the work. Backup/apnea breaths (effort=0, no
// trigger detected) get backupPC instead: the machine is now doing the
// entire breath on its own, so it needs a full pressure-controlled target,
// not just an assist bump. This mirrors real ventilator behavior, where
// apnea backup is effectively a PC breath, not PS with a timer.
export class PressureSupportMode extends BreathMode {
  step(patient, settings, breath, DT) {
    const C = patient.effectiveCompliance();
    const R = patient.resistance;
    const effort = patient.effort; // 0-10
    const s = settings.PS;

    const Ptarget = effort > 0 ? s.peep + s.ps : s.peep + s.backupPC;
    // spontaneous-ish cycling: rate driven by effort (more effort -> faster,
    // more variable)
    const baseRR =
      effort > 0 ? Math.min(28, s.backupRR * 0.6 + effort * 1.6) : s.backupRR;
    const totalCycle = 60 / Math.max(baseRR, 4);
    const Ti = totalCycle * 0.32;
    const Te = totalCycle - Ti;

    if (breath.phase === "insp") {
      const riseTau = 0.05;
      breath.Paw =
        Ptarget - (Ptarget - s.peep) * Math.exp(-breath.phaseTime / riseTau);
      const drive = breath.Paw - s.peep - breath.Vol / C;
      breath.Flow =
        Math.max(drive / Math.max(R, 1), 0) * (effort > 0 ? 1.0 : 0.9);
      breath.Vol += breath.Flow * DT;

      // early termination (flow cycle-off) when flow decays - simplified by Ti
      if (breath.phaseTime >= Ti) {
        breath.phase = "exp";
        breath.phaseTime = 0;
        breath.lastVTi = Math.round(breath.Vol * 1000);
        breath.expStartVol = breath.Vol;
      }
    } else {
      // small negative deflection at end-exhalation if effort>0 (patient trigger)
      let trigDip = 0;
      if (effort > 0) {
        const triggerWindow = Te * 0.85;
        if (breath.phaseTime > triggerWindow) {
          const tFrac =
            (breath.phaseTime - triggerWindow) / (Te - triggerWindow + 1e-6);
          trigDip = -0.3 * effort * Math.sin(Math.min(tFrac, 1) * Math.PI);
        }
      }
      passiveExhale(C, R, s.peep, breath, Te, trigDip);
    }
  }
}
