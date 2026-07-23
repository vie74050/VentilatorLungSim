import { BreathState } from "./BreathState.js";
import { VolumeControlMode } from "../modes/VolumeControlMode.js";
import { PressureControlMode } from "../modes/PressureControlMode.js";
import { PressureSupportMode } from "../modes/PressureSupportMode.js";

// ---------------- SIM CLOCK ----------------
export const FS = 50; // sim steps per second
export const DT = 1 / FS;

// ---------------- VENTILATOR ----------------
// Owns the active mode, delegates each tick to the matching BreathMode,
// and advances the shared sim clock. This replaces the mode dispatch that
// used to live as an if/else chain inside the module-scope step().
export class Ventilator {
  constructor(patient, settings) {
    this.patient = patient;
    this.settings = settings;
    this.breath = new BreathState();
    this.simTime = 0;
    this.mode = "VC"; // VC | PC | PS

    this.modes = {
      VC: new VolumeControlMode(),
      PC: new PressureControlMode(),
      PS: new PressureSupportMode(),
    };
  }

  switchMode(mode) {
    this.mode = mode;
    this.breath.resetForModeSwitch();
  }

  step() {
    this.modes[this.mode].step(this.patient, this.settings, this.breath, DT);
    this.breath.phaseTime += DT;
    this.simTime += DT;
  }
}
