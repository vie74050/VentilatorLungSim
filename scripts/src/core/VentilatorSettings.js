// ---------------- VENTILATOR SETTINGS ----------------
// Holds the three per-mode setting groups (VC/PC/PS). Kept as one object
// (rather than one class instance per mode) because save/load, the
// settings bar, and the control-field registry all need to address a
// setting by [mode][key], and BreathMode subclasses read settings.VC /
// settings.PC / settings.PS directly by mode name.
export const DEFAULT_SETTINGS = {
  VC: { fio2: 40, peep: 5.0, rr: 16, tv: 450 },
  PC: { fio2: 40, peep: 8.0, rr: 18, pc: 15 },
  PS: { fio2: 30, peep: 5.0, ps: 5, backupRR: 10, backupPC: 15 },
};

export class VentilatorSettings {
  constructor() {
    this.VC = { ...DEFAULT_SETTINGS.VC };
    this.PC = { ...DEFAULT_SETTINGS.PC };
    this.PS = { ...DEFAULT_SETTINGS.PS };
  }

  get(mode) {
    return this[mode];
  }

  toJSON() {
    return {
      VC: { ...this.VC },
      PC: { ...this.PC },
      PS: { ...this.PS },
    };
  }

  applyData(data) {
    if (!data) return;
    if (data.VC) Object.assign(this.VC, data.VC);
    if (data.PC) Object.assign(this.PC, data.PC);
    if (data.PS) Object.assign(this.PS, data.PS);
  }
}
