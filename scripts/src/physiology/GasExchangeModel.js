// ---------------- GAS EXCHANGE ----------------
// FiO2 does NOT affect lung mechanics (compliance/resistance/inflation) --
// physiologically it only affects how much oxygen is available to diffuse
// This is a simplified model to tie oxygenation to variables the sim already
// tracks, so a collapsed lung / bad compliance / bad resistance naturally
// produces worse oxygenation without needing separate new sliders.
// Reference: https://www.ncbi.nlm.nih.gov/books/NBK482268/

export const GAS_CONSTANTS = {
  Patm: 760, // mmHg, atmospheric pressure
  PH2O: 47, // mmHg, water vapor pressure at body temp
  RQ: 0.8, // respiratory quotient
  VCO2: 200, // mL/min, resting adult CO2 production
  deadSpace: 0.15, // L, anatomic dead space
};

export class GasExchangeModel {
  constructor(constants = GAS_CONSTANTS) {
    this.GAS = constants;
    this.spO2 = 98;
    this.paO2 = 95;
    this.paCO2 = 40;
    this.shuntFrac = 0;
  }

  // Recomputed once per completed breath, at the insp->exp transition.
  // rFrac is the shared resistance fraction from PatientFractions (0-1),
  // passed in rather than recomputed here to avoid depending on
  // derive PatientFractions having already run this tick.
  update({ patient, peep, fio2, lastVTe, lastRRdisplay, rFrac }) {
    const GAS = this.GAS;

    // local copy, not a shared stiffFrac -- same reasoning as rFrac above
    const stiffFracLocal = Math.max(
      0,
      Math.min(1, (100 - patient.compliance) / 90),
    );

    // Stiffer lungs need MORE PEEP before recruitment kicks in (collapsed
    // units in ARDS take real pressure to reopen), but ALSO have MORE
    // recruitable shunt available once they do -- so both the threshold
    // and the max benefit scale with stiffFrac. A normal lung
    // (stiffFrac~0) has little shunt to recruit in the first place, so
    // this term stays small regardless.
    const recruitThreshold = 5 + stiffFracLocal * 10; // 5 cmH2O (normal) -> 15 cmH2O (severe)
    const recruitMaxBenefit = 0.08 + stiffFracLocal * 0.12; // 0.08 (normal) -> 0.20 (severe)
    const peepRecruitBenefit =
      recruitMaxBenefit *
      (1 - Math.exp(-Math.max(0, peep - recruitThreshold) / 6));

    // Stiffer (ARDS): only a fraction of the lung is aerated, the SAME
    // pressure that's still trying to recruit collapsed regions is
    // overdistending the already-open ones -- overdistension onset drops
    // as stiffFrac rises.
    const overdistensionOnset = 16 - stiffFracLocal * 6; // 16 cmH2O (normal) -> 10 cmH2O (severe)
    const peepOverdistensionPenalty =
      0.08 * Math.max(0, Math.min(1, (peep - overdistensionOnset) / 10));

    this.shuntFrac = Math.min(
      0.6,
      Math.max(
        0,
        stiffFracLocal * 0.4 +
          rFrac * 0.15 +
          (patient.leftCollapsed || patient.rightCollapsed ? 0.25 : 0) -
          peepRecruitBenefit +
          peepOverdistensionPenalty,
      ),
    );

    const vtL = lastVTe / 1000;
    const rr = lastRRdisplay || 1;
    const VA_Lmin = Math.max(rr * (vtL - GAS.deadSpace), 0.1); // alveolar minute ventilation
    // CO2 is driven by ventilation, NOT FiO2 -- keeping these independent
    this.paCO2 = (0.863 * GAS.VCO2) / VA_Lmin; // alveolar ventilation equation
    this.paCO2 = Math.min(Math.max(this.paCO2, 15), 120);

    // Alveolar gas equation, then reduce by shunt to get an effective PaO2.
    const fio2Frac = fio2 / 100;
    const PAO2 = fio2Frac * (GAS.Patm - GAS.PH2O) - this.paCO2 / GAS.RQ;
    this.paO2 = Math.min(Math.max(PAO2 * (1 - this.shuntFrac), 20), 650);

    // Severinghaus approximation of the oxyhemoglobin dissociation curve.
    this.spO2 =
      100 / (23400 / (Math.pow(this.paO2, 3) + 150 * this.paO2) + 1);
    this.spO2 = Math.min(Math.max(this.spO2, 40), 100);
  }
}
