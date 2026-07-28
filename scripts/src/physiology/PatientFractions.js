// ---------------- SHARED PATIENT-DERIVED FRACTIONS ----------------
// derivePatientFractions() is the single source of truth for every
// normalized 0-1 (or small-range) visual quantity derived from
// Patient + BreathState. The SVG renderer (LungVisual2D) consumes this same object -- neither
// one re-derives these formulas independently, so the two visuals can
// never drift apart.
//
// compMin/compMax/resMin/resMax are read from the sComp/sRes slider DOM
// min/max attributes by ControlsRegistry and passed in as `bounds`, rather
// than hardcoded here, so these fractions always match whatever range the
// UI actually allows.
export class PatientFractions {
  static derive({ patient, breath, bounds, peep }) {
    const { compMin, compMax, resMin, resMax } = bounds;
    const C = patient.compliance;
    const R = patient.resistance;
    const nominalMaxL = 0.8; // 800 mL ~ visual full-scale

    const clampedC = Math.min(Math.max(C, compMin), compMax);
    const peepFrac = peep / 20;    
    // PEEP normalized to 0-1, 20cmH2O = max PEEP 
    // this is the min fill fraction for alveoli, so alveoli never visually collapse below this fraction
    const fillFrac = 0.5 * peepFrac + 0.5 * Math.max(0, Math.min(1, breath.Vol / nominalMaxL));
    const expGain =
      1 + ((clampedC - compMin) / (compMax - compMin)) * 0.6; // 1...1.6
    const stiffFrac = Math.max(
      0,
      Math.min(1, (compMax - C) / (compMax - compMin)),
    );
    const rFrac = Math.max(0, Math.min(1, (R - resMin) / (resMax - resMin)));

    const alvScale = 1 + fillFrac * 1.35 * expGain;
    const overDist = breath.Paw > 30 && fillFrac > 0.6;

    // Per-side lung inflation fraction, already collapse-aware.
    const leftLungFrac = patient.leftCollapsed ? 0 : fillFrac * expGain;
    const rightLungFrac = patient.rightCollapsed ? 0 : fillFrac * expGain;

    // Per-side bronchus width (SVG stroke-width units, not a 0-1
    // fraction), already collapse-aware 
    const BRONCH_OPEN_WIDTH = 6 - rFrac * 3.2; // narrows as resistance climbs
    const BRONCH_OCCLUDED_WIDTH = 1.8;
    const bronchLWidth = patient.leftCollapsed
      ? BRONCH_OCCLUDED_WIDTH
      : BRONCH_OPEN_WIDTH;
    const bronchRWidth = patient.rightCollapsed
      ? BRONCH_OCCLUDED_WIDTH
      : BRONCH_OPEN_WIDTH;

    return {
      fillFrac,
      expGain,
      stiffFrac,
      rFrac,
      alvScale,
      overDist,
      leftLungFrac,
      rightLungFrac,
      bronchLWidth,
      bronchRWidth,
    };
  }

  // O2/CO2 dot-intensity fractions come from gas exchange results rather
  // than mechanics, so they're derived separately from the rest but still
  // merged onto the same shared object by the caller.
  static deriveGasFractions({ spo2, paCO2 }) {
    // SpO2: plateau at full intensity across the clinically-acceptable
    // range (>=90%, the standard "keep SpO2 >=90" target), then a narrow,
    // steep ramp down to 0 by 70% (severe hypoxemia). Narrow ramp = obvious
    // change per point of desaturation, rather than a shallow gradient
    // across the full sim range.
    const o2Frac = spo2 >= 90 ? 1 : Math.max(0, (spo2 - 70) / 20);

    // PaCO2: flat, dim baseline across the normal range (35-45 mmHg) --
    // normal CO2 clearance shouldn't read as alarming. Ramps up toward
    // full intensity in EITHER direction outside normal: above 45 toward
    // 80 (hypercapnia/retention, the common case in ARDS/COPD/collapsed-
    // lung scenarios here), or below 35 toward 20 (hypocapnia/
    // hyperventilation).
    const CO2_BASELINE = 0.2;
    let co2Frac;
    if (paCO2 >= 35 && paCO2 <= 45) {
      co2Frac = CO2_BASELINE;
    } else if (paCO2 > 45) {
      co2Frac =
        CO2_BASELINE + (1 - CO2_BASELINE) * Math.min(1, (paCO2 - 45) / 35);
    } else {
      co2Frac =
        CO2_BASELINE + (1 - CO2_BASELINE) * Math.min(1, (35 - paCO2) / 15);
    }

    return { o2Frac, co2Frac };
  }
}
