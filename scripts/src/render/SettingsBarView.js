// ---------------- SETTINGS BAR (device bottom strip) ----------------
export const MODE_NOTES = {
  VC: "<b>Volume Control:</b> you set tidal volume + rate; the vent delivers a fixed flow pattern and <b>pressure is the result</b> \u2014 watch Ppeak rise as compliance drops or resistance climbs.",
  PC: "<b>Pressure Control:</b> you set a pressure target above PEEP; the vent holds that pressure and <b>volume is the result</b> \u2014 watch VTe fall if compliance drops, even though pressure stays fixed.",
  PS: "<b>PS/CPAP:</b> the patient triggers each breath; the vent only supports it with a fixed pressure boost. Raise <b>patient effort</b> to see spontaneous triggering, or set effort to 0 to see backup (apnea) breaths take over.",
};

export class SettingsBarView {
  constructor(barEl, modeNoteEl) {
    this.barEl = barEl;
    this.modeNoteEl = modeNoteEl;
  }

  render(mode, settings) {
    let tiles = [];
    if (mode === "VC") {
      const s = settings.VC;
      tiles = [
        ["FiO\u2082 %", s.fio2],
        ["PEEP", s.peep.toFixed(1)],
        ["RR", s.rr],
        ["Tidal volume", s.tv],
      ];
    } else if (mode === "PC") {
      const s = settings.PC;
      tiles = [
        ["FiO\u2082 %", s.fio2],
        ["PEEP", s.peep.toFixed(1)],
        ["RR", s.rr],
        ["PC above\nPEEP", s.pc],
      ];
    } else {
      const s = settings.PS;
      tiles = [
        ["FiO\u2082 %", s.fio2],
        ["PEEP", s.peep.toFixed(1)],
        ["PS above\nPEEP", s.ps],
        ["Backup RR", s.backupRR],
        ["Backup PC\nabove PEEP", s.backupPC],
      ];
    }
    this.barEl.innerHTML = tiles
      .map(
        (t) =>
          `<div class="settile" data-key="${t[0]}"><div class="lbl">${t[0].replace("\n", "<br>")}</div><div class="val">${t[1]}</div></div>`,
      )
      .join("");
  }

  flash() {
    this.barEl.querySelectorAll(".settile").forEach((el) => {
      el.classList.remove("flash");
      void el.offsetWidth; // force reflow so re-adding "flash" restarts the CSS animation
      el.classList.add("flash");
    });
  }

  setModeNote(mode) {
    this.modeNoteEl.innerHTML = MODE_NOTES[mode];
  }
}
