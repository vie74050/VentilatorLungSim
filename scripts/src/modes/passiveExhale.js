// ---------------- PASSIVE EXHALATION ----------------
// Exponential decay from the fixed starting volume of this breath --
// identical across VC, PC, and PS, so it's factored out here rather than
// repeated in each mode. PS adds a small extra pressure term (the patient
// trigger dip) on top; VC/PC just pass 0.
export function passiveExhale(C, R, peep, breath, Te, extraPaw = 0) {
  const tau = R * C;
  const v0 = breath.expStartVol;
  const decay = Math.exp(-breath.phaseTime / Math.max(tau, 0.05));

  breath.Vol = v0 * decay;
  breath.Flow = -(v0 / Math.max(tau, 0.05)) * decay;
  breath.Paw = peep + breath.Vol / C + extraPaw;

  if (breath.phaseTime >= Te) {
    breath.lastVTe = Math.round(v0 * 1000);
    breath.phase = "insp";
    breath.phaseTime = 0;
    breath.Vol = 0;
  }
}
