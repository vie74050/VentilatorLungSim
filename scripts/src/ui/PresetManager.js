// ---------------- PRESET MANAGER ----------------
export class PresetManager {
  constructor({ $, patient, controlsBinder, modeController }) {
    this.$ = $;
    this.patient = patient;
    this.controlsBinder = controlsBinder;
    this.modeController = modeController;
  }

  wire() {
    const presetSelect = this.$("presetSelect");
    if (!presetSelect) return;
    presetSelect.addEventListener("change", () => {
      const p = presetSelect.value;
      if (p === "normal") this.setPatient(50, 4, 0);
      if (p === "ards") this.setPatient(22, 16, 0);
      if (p === "copd") this.setPatient(60, 32, 0);
      if (p === "spontaneous") {
        this.setPatient(50, 10, 6);
        this.modeController.switchMode("PS");
      }
      presetSelect.value = ""; // reset to placeholder so re-selecting the same preset again still fires change
    });
  }

  setPatient(c, r, e, leftCollapsed = false, rightCollapsed = false) {
    this.patient.compliance = c;
    this.patient.resistance = r;
    this.patient.effort = e;
    this.patient.leftCollapsed = leftCollapsed;
    this.patient.rightCollapsed = rightCollapsed;
    this.controlsBinder.refresh();
  }
}
