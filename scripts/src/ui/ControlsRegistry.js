// ---------------- CONTROL FIELD REGISTRY ----------------
// Single source of truth for every slider/checkbox <-> state mapping.
// Binding, preset application, and save/load/refresh all read this same
// list instead of maintaining separate hardcoded field lists that could
// drift out of sync as controls are added.
export function buildSliderFields(patient, settings) {
  return [
    { sliderId: "sFiO2", readoutId: "rFiO2", store: settings.VC, key: "fio2", isFloat: false, isVentilatorSetting: true },
    { sliderId: "sPEEPvc", readoutId: "rPEEPvc", store: settings.VC, key: "peep", isFloat: true, isVentilatorSetting: true },
    { sliderId: "sRRvc", readoutId: "rRRvc", store: settings.VC, key: "rr", isFloat: false, isVentilatorSetting: true },
    { sliderId: "sTV", readoutId: "rTV", store: settings.VC, key: "tv", isFloat: false, isVentilatorSetting: true },

    { sliderId: "sFiO2pc", readoutId: "rFiO2pc", store: settings.PC, key: "fio2", isFloat: false, isVentilatorSetting: true },
    { sliderId: "sPEEPpc", readoutId: "rPEEPpc", store: settings.PC, key: "peep", isFloat: true, isVentilatorSetting: true },
    { sliderId: "sRRpc", readoutId: "rRRpc", store: settings.PC, key: "rr", isFloat: false, isVentilatorSetting: true },
    { sliderId: "sPC", readoutId: "rPC", store: settings.PC, key: "pc", isFloat: false, isVentilatorSetting: true },

    { sliderId: "sFiO2ps", readoutId: "rFiO2ps", store: settings.PS, key: "fio2", isFloat: false, isVentilatorSetting: true },
    { sliderId: "sPEEPps", readoutId: "rPEEPps", store: settings.PS, key: "peep", isFloat: true, isVentilatorSetting: true },
    { sliderId: "sPS", readoutId: "rPS", store: settings.PS, key: "ps", isFloat: false, isVentilatorSetting: true },
    { sliderId: "sBackupRR", readoutId: "rBackupRR", store: settings.PS, key: "backupRR", isFloat: false, isVentilatorSetting: true },
    { sliderId: "sBackupPC", readoutId: "rBackupPC", store: settings.PS, key: "backupPC", isFloat: false, isVentilatorSetting: true },

    { sliderId: "sComp", readoutId: "rComp", store: patient, key: "compliance", isFloat: false },
    { sliderId: "sRes", readoutId: "rRes", store: patient, key: "resistance", isFloat: false },
    { sliderId: "sEffort", readoutId: "rEffort", store: patient, key: "effort", isFloat: false, fmt: (v) => (v === 0 ? "0 (none)" : v) },
  ];
}

export function buildCheckboxFields() {
  return [
    { id: "chkLeftCollapsed", key: "leftCollapsed" },
    { id: "chkRightCollapsed", key: "rightCollapsed" },
  ];
}

// Slider normalization bounds (used by PatientFractions) are read from the
// DOM min/max attributes of sComp/sRes rather than hardcoded, so the
// visual fractions always track whatever range the UI actually exposes.
// Falls back to the simulator's original defaults if the markup is
// missing an attribute.
export function readPatientSliderBounds($) {
  const compEl = $("sComp");
  const resEl = $("sRes");
  const num = (el, attr, fallback) =>
    el && el[attr] !== "" && !Number.isNaN(parseFloat(el[attr]))
      ? parseFloat(el[attr])
      : fallback;

  return {
    compMin: num(compEl, "min", 10),
    compMax: num(compEl, "max", 100),
    resMin: num(resEl, "min", 4),
    resMax: num(resEl, "max", 40),
  };
}
