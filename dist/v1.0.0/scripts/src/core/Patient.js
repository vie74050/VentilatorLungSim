// ---------------- PATIENT MODEL ----------------
// Physiological state of the simulated patient: compliance, resistance,
// spontaneous effort, and left/right collapse flags. Owns the
// collapsed-lung effective-compliance math -- everything else (breath
// modes, gas exchange, visuals) reads compliance through
// effectiveCompliance() rather than patient.compliance directly.
export class Patient {
  constructor({
    compliance = 50,
    resistance = 10,
    effort = 0,
    leftCollapsed = false,
    rightCollapsed = false,
  } = {}) {
    this.compliance = compliance;
    this.resistance = resistance;
    this.effort = effort;
    this.leftCollapsed = leftCollapsed;
    this.rightCollapsed = rightCollapsed;
  }

  // Two lungs in parallel roughly add their compliance. Taking one offline
  // (pneumothorax, complete atelectasis, mainstem intubation) doesn't
  // change patient.compliance itself -- it changes how much of it is still
  // usable. This is what makes Ppeak rise (VC) / VTe fall (PC) with a
  // collapsed lung, same mechanism as any other compliance-lowering
  // condition already modeled. Right lung is given the larger share
  // (~55/45) to reflect its larger normal volume (left lung is smaller due
  // to the cardiac notch).
  effectiveCompliance() {
    const C = this.compliance / 1000; // mL/cmH2O -> L/cmH2O
    if (this.leftCollapsed && this.rightCollapsed) return C * 0.1; // both down -- extreme edge case, not zero to avoid divide-by-zero blowups
    if (this.rightCollapsed) return C * 0.45; // only left (smaller) lung ventilating
    if (this.leftCollapsed) return C * 0.55; // only right (larger) lung ventilating
    return C;
  }

  set(c, r, e, leftCollapsed = false, rightCollapsed = false) {
    this.compliance = c;
    this.resistance = r;
    this.effort = e;
    this.leftCollapsed = leftCollapsed;
    this.rightCollapsed = rightCollapsed;
  }

  toJSON() {
    return {
      compliance: this.compliance,
      resistance: this.resistance,
      effort: this.effort,
      leftCollapsed: this.leftCollapsed,
      rightCollapsed: this.rightCollapsed,
    };
  }

  applyData(data) {
    if (!data || typeof data !== "object") return;
    Object.assign(this, data);
  }
}
