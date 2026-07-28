import { BreathMode } from "./BreathMode.js";
import { passiveExhale } from "./passiveExhale.js";

// ---------------- PRESSURE CONTROL ----------------
// You set a pressure target above PEEP; the vent holds that pressure and
// volume is the result.
export class PressureControlMode extends BreathMode {
  step(patient, settings, breath, DT) {
    const C = patient.effectiveCompliance();
    const R = patient.resistance;
    const s = settings.PC;

    const totalCycle = 60 / s.rr;
    const Ti = totalCycle * 0.35;
    const Te = totalCycle - Ti;
    const Ptarget = s.peep + s.pc;

    if (breath.phase === "insp") {
      const riseTau = 0.06;
      breath.Paw =
        Ptarget - (Ptarget - s.peep) * Math.exp(-breath.phaseTime / riseTau);
      const drive = breath.Paw - s.peep - breath.Vol / C;
      breath.Flow = Math.max(drive / Math.max(R, 1), 0);
      breath.Vol += breath.Flow * DT;

      if (breath.phaseTime >= Ti) {
        breath.phase = "exp";
        breath.phaseTime = 0;
        breath.lastVTi = Math.round(breath.Vol * 1000);
        breath.expStartVol = breath.Vol;
      }
    } else {
      passiveExhale(C, R, s.peep, breath, Te);
    }
  }
}
