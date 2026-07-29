// ---------------- SHARED PATIENT-DERIVED FRACTIONS ----------------
// derive PatientFractions is the single source of truth for every
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
    // peepFrac = PEEP normalized to 0-1, PEEP = 5-20cmH2O -> 0.25-1
    // fillFrac 0.25 - 1
    const fillFrac = 0.5 * peepFrac + 0.5 * Math.max(0, Math.min(1, breath.Vol / nominalMaxL));
    const expGain =
      1 + ((clampedC - compMin) / (compMax - compMin)) * 0.6; // 1...1.6
    const stiffFrac = Math.max(
      0,
      Math.min(1, (compMax - C) / (compMax - compMin)),
    );
    const rFrac = Math.max(0, Math.min(1, (R - resMin) / (resMax - resMin)));

    const alvScale = 1 + fillFrac * 2 * expGain;
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

  // deriveGasFractions is the single source of truth for every normalized 0-1 (or small-range) visual quantity derived from PaO2/PaCO2. The SVG renderer (LungVisual2D) consumes this same object.
  static deriveGasFractions({ paO2, paCO2 }) {
    // for visualizing paO2: 
    // normal range ~80-100mmHg
    // normalize to s-curve 0-1 for visual intensity
    
    const o2Frac = 1 / (1 + Math.exp(-(2 *paO2 - 160) / 10)); 
   
    // for visualizing cO2: 
    // normal range ~35-45mmHg, 
    // hypercapnia > 45mmHg, 
    // hypocapnia < 35mmHg
    
    const co2Frac = 1 / (1 + Math.exp(-(paCO2 - 20) / 5));   
    //console.log (co2Frac, "co2Frac", paCO2, "paCO2");
    return { o2Frac, co2Frac };
  }
}
