// ---------------- SAVE / LOAD SNAPSHOT ----------------
export class SnapshotService {
  constructor({ document, $, patient, settings, controlsBinder, modeController, getMode }) {
    this.document = document;
    this.$ = $;
    this.patient = patient;
    this.settings = settings;
    this.controlsBinder = controlsBinder;
    this.modeController = modeController;
    this.getMode = getMode;
  }

  serializeState() {
    return {
      version: 1,
      mode: this.getMode(),
      settings: this.settings.toJSON(),
      patient: this.patient.toJSON(),
    };
  }

  applyState(data) {
    if (!data || typeof data !== "object") return;
    if (data.settings) this.settings.applyData(data.settings);
    if (data.patient) this.patient.applyData(data.patient);

    this.controlsBinder.refresh();

    const currentMode = this.getMode();
    const targetMode =
      data.mode === "VC" || data.mode === "PC" || data.mode === "PS"
        ? data.mode
        : currentMode;
    // also refreshes the settings bar, active tab, mode note, and resets
    // breath state for a clean start
    this.modeController.switchMode(targetMode);
  }

  wireSaveButton() {
    const btnSave = this.$("btnSaveSettings");
    if (!btnSave) return;
    btnSave.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(this.serializeState(), null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = this.document.createElement("a");
      a.href = url;
      a.download = "settings.json";
      this.document.body.appendChild(a);
      a.click();
      this.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  wireLoadButton() {
    const btnLoad = this.$("btnLoadSettings");
    const loadFileInput = this.$("loadFileInput");
    if (!btnLoad || !loadFileInput) return;
    btnLoad.addEventListener("click", () => loadFileInput.click());
    loadFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          this.applyState(JSON.parse(reader.result));
        } catch (err) {
          console.error("Failed to load settings file:", err);
          alert(
            "Couldn't load that file -- make sure it's a settings.json exported from this simulator.",
          );
        }
      };
      reader.readAsText(file);
      e.target.value = ""; // reset so re-selecting the same file still fires change next time
    });
  }

  // On page load, check for a settings.json sitting alongside index.html
  // (e.g. an instructor-uploaded case file in the same LMS folder). Fails
  // silently and keeps the hardcoded defaults if none is found, or if the
  // page was opened directly via file:// where fetch() of local files is
  // often blocked by the browser.
  autoLoadFromDisk() {
    fetch("settings.json")
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error("no settings.json")),
      )
      .then((data) => this.applyState(data))
      .catch(() => {
        /* no settings.json present -- keep hardcoded defaults */
      });
  }
}
