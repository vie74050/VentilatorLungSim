import { Patient } from "./core/Patient.js";
import { VentilatorSettings } from "./core/VentilatorSettings.js";
import { Ventilator, DT } from "./core/Ventilator.js";
import { BreathTracker } from "./core/BreathTracker.js";
import { BreathHistory } from "./core/BreathHistory.js";

import { GasExchangeModel } from "./physiology/GasExchangeModel.js";
import { PatientFractions } from "./physiology/PatientFractions.js";

import { Autoscale } from "./render/Autoscale.js";
import { ScopeRenderer } from "./render/ScopeRenderer.js";
import { LungVisual2D } from "./render/LungVisual2D.js";
import { SettingsBarView } from "./render/SettingsBarView.js";

import {
  buildSliderFields,
  buildCheckboxFields,
  readPatientSliderBounds,
} from "./ui/ControlsRegistry.js";
import { ControlsBinder } from "./ui/ControlsBinder.js";
import { ModeController } from "./ui/ModeController.js";
import { PresetManager } from "./ui/PresetManager.js";

import { SnapshotService } from "./persistence/SnapshotService.js";

const HIST_SECONDS = 8;
const FS = 50; // sim steps per second, matches Ventilator's clock

// ---------------- VENT SIM APP ----------------
// Top-level composition root: owns one instance of every model/view/
// controller, wires them together, and drives the fixed-step sim loop +
// render loop (matches the original module's `loop()` / STATE / init
// section). Everything else in this codebase is a plain class with no
// knowledge of the DOM event loop; this is the one place that ties them
// to `requestAnimationFrame` and the page.
export class VentSimApp {
  constructor(doc = document, win = window) {
    this.document = doc;
    this.window = win;
    this.$ = (id) => doc.getElementById(id);

    // ---- domain state ----
    this.patient = new Patient();
    this.settings = new VentilatorSettings();
    this.ventilator = new Ventilator(this.patient, this.settings);
    this.gasExchange = new GasExchangeModel();
    this.history = new BreathHistory(HIST_SECONDS, FS);
    this.autoscale = new Autoscale();

    // last-computed shared fractions, read (stale-by-one-frame,
    // same as the original) by GasExchangeModel at each breath boundary
    this.lastFractions = { rFrac: 0 };

    this.breathTracker = new BreathTracker({
      onExpStart: () => {
        const s = this.settings[this.ventilator.mode];
        this.gasExchange.update({
          patient: this.patient,
          peep: s.peep,
          fio2: s.fio2,
          lastVTe: this.ventilator.breath.lastVTe,
          lastRRdisplay: this.ventilator.breath.lastRRdisplay,
          rFrac: this.lastFractions.rFrac,
        });
        this.autoscale.pushSample("paw", this.ventilator.breath.lastPpeak);
        this.autoscale.pushSample("vol", this.ventilator.breath.lastVTi);
      },
      onInspStart: (peakFlowAbs) => {
        this.autoscale.pushSample("flow", peakFlowAbs);
      },
    });

    // ---- views ----
    this.canvas = this.$("scopeCanvas");
    this.scopeRenderer = new ScopeRenderer(this.canvas, this.history, this.autoscale);

    this.lungVisual = new LungVisual2D({
      lungL: this.$("lungL"),
      lungR: this.$("lungR"),
      lungLimg: this.$("lungLimg"),
      lungRimg: this.$("lungRimg"),
      bronchL: this.$("bronchL"),
      bronchR: this.$("bronchR"),
      alvCircles: doc.querySelectorAll(".alv"),
      o2Circles: doc.querySelectorAll(".gas-dot-o2"),
      co2Circles: doc.querySelectorAll(".gas-dot-co2"),
      gasExchangeGroup: this.$("gasExchange"),
      vPpeak: this.$("vPpeak"),
      vRR: this.$("vRR"),
      vMV: this.$("vMV"),
      vVTi: this.$("vVTi"),
      vVTe: this.$("vVTe"),
      lpComp: this.$("lpComp"),
      lpRes: this.$("lpRes"),
      lpSpO2: this.$("lpSpO2"),
      lpPaCO2: this.$("lpPaCO2"),
    });
    this.readouts = this.lungVisual.readouts;

    this.settingsBarView = new SettingsBarView(this.$("settingsBar"), this.$("modeNote"));

    // ---- controls / UI wiring ----
    this.controlsBinder = new ControlsBinder({
      $: this.$,
      patient: this.patient,
      settings: this.settings,
      sliderFields: buildSliderFields(this.patient, this.settings),
      checkboxFields: buildCheckboxFields(),
      settingsBarView: this.settingsBarView,
      getMode: () => this.ventilator.mode,
    });

    this.modeController = new ModeController({
      document: doc,
      $: this.$,
      ventilator: this.ventilator,
      breathTracker: this.breathTracker,
      settingsBarView: this.settingsBarView,
    });

    this.presetManager = new PresetManager({
      $: this.$,
      patient: this.patient,
      controlsBinder: this.controlsBinder,
      modeController: this.modeController,
    });

    this.snapshotService = new SnapshotService({
      document: doc,
      $: this.$,
      patient: this.patient,
      settings: this.settings,
      controlsBinder: this.controlsBinder,
      modeController: this.modeController,
      getMode: () => this.ventilator.mode,
    });

    // ---- loop bookkeeping ----
    this.lastFrameWall = performance.now();
    this.accum = 0;
    this._loop = this._loop.bind(this);
  }

  init() {
    this.controlsBinder.bindAll();
    this.modeController.wireModeButtons();
    this.modeController.wireDeckTabs();
    this.presetManager.wire();
    this.snapshotService.wireSaveButton();
    this.snapshotService.wireLoadButton();

    this.window.addEventListener("resize", () => this.scopeRenderer.fitCanvas());
    this.scopeRenderer.fitCanvas();
    this.settingsBarView.render(this.ventilator.mode, this.settings);

    this.snapshotService.autoLoadFromDisk();

    requestAnimationFrame(this._loop);
  }

  _loop() {
    const now = performance.now();
    let dtWall = (now - this.lastFrameWall) / 1000;
    this.lastFrameWall = now;
    dtWall = Math.min(dtWall, 0.1);
    this.accum += dtWall;

    while (this.accum >= DT) {
      this.ventilator.step();
      this.breathTracker.update(this.ventilator);
      const b = this.ventilator.breath;
      this.history.push(b.Paw, b.Flow * 60, b.Vol * 1000); // flow displayed L/min, vol displayed mL
      this.accum -= DT;
    }

    this.scopeRenderer.render();
    this.readouts.updateVentilatorReadouts(this.ventilator.breath);

    // single source of truth for both visualizations below
    const bounds = readPatientSliderBounds(this.$);
    const peep = this.settings[this.ventilator.mode].peep;
    const fractions = PatientFractions.derive({
      patient: this.patient,
      breath: this.ventilator.breath,
      bounds,
      peep
    });
    Object.assign(fractions, PatientFractions.deriveGasFractions(this.gasExchange));
    this.lastFractions = fractions;

    this._updateVisuals(fractions);

    requestAnimationFrame(this._loop);
  }

  _updateVisuals(fractions) {
    
    this.lungVisual.update(this.patient, fractions, this.gasExchange);
    
  }
}
