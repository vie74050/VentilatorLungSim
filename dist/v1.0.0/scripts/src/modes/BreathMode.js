// ---------------- BREATH MODE (base) ----------------
// Common interface for VC / PC / PS breath mechanics. Single compartment
// lung model: Paw = PEEP + V/C + R*Flow (Flow in L/s, V in L, R in
// cmH2O/L/s). Each subclass implements step() for its own insp/exp
// mechanics and mutates the shared BreathState in place.
export class BreathMode {
  /**
   * @param {import('../core/Patient.js').Patient} patient
   * @param {import('../core/VentilatorSettings.js').VentilatorSettings} settings
   * @param {import('../core/BreathState.js').BreathState} breath
   * @param {number} DT - sim step, seconds
   */
  // eslint-disable-next-line no-unused-vars
  step(patient, settings, breath, DT) {
    throw new Error("step() must be implemented by a BreathMode subclass");
  }
}
