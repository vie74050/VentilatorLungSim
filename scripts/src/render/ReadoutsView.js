// ---------------- READOUTS ----------------
// Ventilator panel numbers (Ppeak/RR/MV/VTi/VTe) and lung panel patient
// model readouts (compliance/resistance/SpO2/PaCO2 text). Note: the
// original per-field DOM-write gating on lpComp/lpRes used variables that
// were re-declared (and reset) on every call, so the guard never actually
// skipped a write -- functionally identical to writing unconditionally
// every call, which is what this does.
export class ReadoutsView {
  constructor(dom) {
    this.dom = dom; // { vPpeak, vRR, vMV, vVTi, vVTe, lpComp, lpRes, lpSpO2, lpPaCO2 }
  }

  updateVentilatorReadouts(breath) {
    const { dom } = this;
    dom.vPpeak.textContent =
      breath.lastPpeak > 0 ? breath.lastPpeak.toFixed(0) : "--";
    dom.vRR.textContent = breath.lastRRdisplay;
    const mv = (breath.lastVTe / 1000) * breath.lastRRdisplay;
    dom.vMV.textContent = mv.toFixed(1);
    dom.vVTi.textContent = breath.lastVTi || "--";
    dom.vVTe.textContent = breath.lastVTe || "--";
  }

  updateLungPanelReadouts(patient, spO2, paO2, paCO2) {
    const { dom } = this;
    if (dom.lpComp) dom.lpComp.textContent = patient.compliance;
    if (dom.lpRes) dom.lpRes.textContent = patient.resistance;
    if (dom.lpSpO2) dom.lpSpO2.textContent = spO2.toFixed(0);
    if (dom.lpPaO2) dom.lpPaO2.textContent = paO2.toFixed(0);
    if (dom.lpPaCO2) dom.lpPaCO2.textContent = paCO2.toFixed(0);
  }
}
