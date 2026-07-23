// ---------------- UNITY SNAPSHOT BUILDER ----------------
// Plain snapshot object handed to the Unity bridge every frame -- the
// bridge itself decides whether it's worth actually sending (throttle +
// send-on-change gating live entirely in unity-bridge.js).
//
// Every field here is read straight from PatientFractions.derive() /
// deriveGasFractions() and GasExchangeModel -- the same single source of
// truth the SVG renderer (LungVisual2D) consumes, so the two visuals can
// never drift apart from each other.
export class UnitySnapshotBuilder {
  build({ patient, breath, fractions, gas }) {
    return {
      leftLungFrac: fractions.leftLungFrac, // left lung blend-shape inflate weight input (x100 for 0-100 weight); range 0 - ~1.6; 0 when leftCollapsed
      rightLungFrac: fractions.rightLungFrac, // same, right lung; range 0 - ~1.6; 0 when rightCollapsed
      stiffFrac: fractions.stiffFrac, // lung material _Stiffness property; range 0 (floppy) - 1 (stiff)
      bronchLWidth: fractions.bronchLWidth, // left bronchiole localScale input; range 1.8 (occluded/collapsed) - 6 (fully open)
      bronchRWidth: fractions.bronchRWidth, // same, right bronchiole; range 1.8 - 6
      alvScale: fractions.alvScale, // alveoli sphere uniform scale; range 1.0 (empty) - ~3.16 (full inflation, low compliance floor)
      overDist: fractions.overDist, // lung material _Overdistend flag; 0 or 1 (boolean)
      phase: breath.phase, // breath phase, selects lerp speed (LERP_INSP vs LERP_EXP); "insp" or "exp"
      effort: patient.effort, // diaphragm Animator "Effort" float param; range 0 (passive) - 10 (max drive)
      spo2: gas.spo2, // lung material _SpO2 property (blood color lerp); range 40 - 100 (%)
      paCO2: gas.paCO2, // lung material _PaCO2 property; range 15 - 120 (mmHg)
      o2Frac: fractions.o2Frac, // O2 particle system emission rate + simulationSpeed input; range 0 - 1
      co2Frac: fractions.co2Frac, // CO2 particle system emission rate + simulationSpeed input; range 0.2 (normal baseline) - 1
      shuntFrac: gas.shuntFrac, // lung material _ShuntFrac property; range 0 - 0.6
      leftCollapsed: patient.leftCollapsed, // selects BLEND_COLLAPSED vs BLEND_INFLATE target on left lung mesh; boolean
    };
  }
}
