// ---------------- CONTROLS BINDER ----------------
// Wires slider/checkbox fields (from ControlsRegistry) to their DOM
// elements, and pushes current state back into the DOM (used after a
// preset, a Load, or the settings.json auto-load).
export class ControlsBinder {
  constructor({ $, patient, settings, sliderFields, checkboxFields, settingsBarView, getMode }) {
    this.$ = $;
    this.patient = patient;
    this.settings = settings;
    this.sliderFields = sliderFields;
    this.checkboxFields = checkboxFields;
    this.settingsBarView = settingsBarView;
    this.getMode = getMode;
  }

  bindAll() {
    this.sliderFields.forEach((f) => this._bindSlider(f));
    this.checkboxFields.forEach((f) => this._bindCheckbox(f));
  }

  _bindSlider(f) {
    const el = this.$(f.sliderId);
    if (!el) return;
    el.addEventListener("input", () => {
      const v = f.isFloat ? parseFloat(el.value) : parseInt(el.value, 10);
      f.store[f.key] = v;
      this.$(f.readoutId).textContent = f.fmt
        ? f.fmt(v)
        : f.isFloat
          ? v.toFixed(1)
          : v;
      if (f.isVentilatorSetting) {
        this.settingsBarView.render(this.getMode(), this.settings);
        this.settingsBarView.flash();
      }
    });
  }

  _bindCheckbox(f) {
    const el = this.$(f.id);
    if (!el) return; // tolerate markup not being present yet
    el.addEventListener("change", () => {
      this.patient[f.key] = el.checked;
    });
  }

  // Pushes current settings/patient state into every bound slider/
  // checkbox's DOM (value + readout text) -- used after a preset, a Load,
  // or the settings.json auto-load, so the UI always matches the
  // underlying state.
  refresh() {
    this.sliderFields.forEach((f) => {
      const el = this.$(f.sliderId);
      if (!el) return;
      const v = f.store[f.key];
      el.value = v;
      this.$(f.readoutId).textContent = f.fmt
        ? f.fmt(v)
        : f.isFloat
          ? Number(v).toFixed(1)
          : v;
    });
    this.checkboxFields.forEach((f) => {
      const el = this.$(f.id);
      if (!el) return;
      el.checked = !!this.patient[f.key];
    });
    this.settingsBarView.render(this.getMode(), this.settings);
  }
}
