// ---------------- MODE CONTROLLER ----------------
// Owns mode-switch UI wiring (mode buttons, group show/hide, settings bar
// refresh, mode note) and deck-tab wiring. Ventilator/BreathTracker resets
// are delegated to the callback passed in, keeping this class DOM-only.
export class ModeController {
  constructor({ document, $, ventilator, breathTracker, settingsBarView, onModeChange }) {
    this.document = document;
    this.$ = $;
    this.ventilator = ventilator;
    this.breathTracker = breathTracker;
    this.settingsBarView = settingsBarView;
    this.onModeChange = onModeChange || (() => {});
  }

  switchMode(m) {
    this.ventilator.switchMode(m); // resets breath state for a clean transition
    this.breathTracker.reset();

    this.document
      .querySelectorAll(".modebtn[data-mode]")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    this.$("vcGroup").style.display = m === "VC" ? "" : "none";
    this.$("pcGroup").style.display = m === "PC" ? "" : "none";
    this.$("psGroup").style.display = m === "PS" ? "" : "none";

    this.settingsBarView.render(m, this.ventilator.settings);
    this.settingsBarView.setModeNote(m);

    this.onModeChange(m);
  }

  wireModeButtons() {
    this.document.querySelectorAll(".modebtn[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => this.switchMode(btn.dataset.mode));
    });
  }

  wireDeckTabs() {
    this.document.querySelectorAll(".deck-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        this.document
          .querySelectorAll(".deck-tab")
          .forEach((b) => b.classList.toggle("active", b === btn));
        this.document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
          panel.style.display = panel.dataset.tabPanel === target ? "" : "none";
        });
      });
    });
  }
}
