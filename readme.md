# BCIT Ventilator Simulator

A web-based training simulator for mechanical ventilation that models core respiratory mechanics and gas-exchange trends. It lets users adjust ventilator controls and set patient parameters to visualize pressure, flow, volume changes, and gas exchange.

## Development Reference

Intended endpoint will be an HTML page that can be deployed to D2L as an all client-side, no-build, single content page.

`vent-scripts.js` (wrapped in an IIFE, no imports/exports, no bundler).  
It draws the ventilator control panel and continuously simulates a "patient" breathing on that ventilator, at 50 simulation steps per second, rendering the scrolling waveforms and driving the svg & webGl animations.

### Physiologic Simulation Overview

The "patient" is modeled as one elastic balloon (a **single-compartment lung model**), governed by one equation used everywhere in `step()`:

```formula
Paw = PEEP + Vol/Compliance + Resistance × Flow
```

**PEEP** = baseline pressure the vent maintains between breaths.

**Compliance (C)** = effective compliance, L/cmH₂O (`patient.compliance / 1000`, adjusted for collapsed lung — §4.2)

- how stretchy the lungs are.
- Low C = stiff lungs (e.g. ARDS/fibrosis) → same volume needs much more pressure.
- High C = floppy lungs (e.g. emphysema).

**Resistance (R)** = airway resistance, cmH₂O/L/s (`patient.resistance`, used directly)  

- how narrow/clogged the airway is.
- High R = more pressure lost just moving air through the tube, independent of lung stretch.

Below documents the different manipulation of this under each **Ventilator Mode**, and how the visualizations are driven.

### 1. Ventilator settings — Volume Control (VC) mode

| Control | Slider range | Variable | Directly affects |
| --- | --- | --- | --- |
| Tidal volume | 150–700 mL | `settings.VC.tv` | Target inspiratory volume |
| Respiratory rate | 5–35 br/min | `settings.VC.rr` | Cycle timing |
| PEEP | 0–20 cmH₂O | `settings.VC.peep` | Baseline pressure |
| FiO₂ | 21–100% | `settings.VC.fio2` | SpO₂/PaO₂ only (§5) |

**Cycle timing:**

```formula
totalCycle = 60 / rr
Ti (inspiratory time) = totalCycle × 0.35
Te (expiratory time)  = totalCycle − Ti
```

**Inspiration** — flow-controlled, volume-targeted (this is the defining behavior of VC: the machine guarantees the volume, and pressure is whatever it takes to deliver it):

```formula
targetVL = tv / 1000                          (mL -> L)
peakFlow = targetVL / Ti × rampAmt            (L/s)
 rampAmt (1.1-2) is a visual modifier so starts slightly higher, then decays

Vol += Flow × DT                               (integrated each 20ms tick)
Paw = PEEP + Vol/C + R × Flow                  ← pressure is the RESULT
```

CHECK: Expect stiffer lungs (lower C) or more resistance (higher R) increases **Ppeak** in VC mode — the volume delivered doesn't change, but the pressure required to deliver it does, per the equation directly.

**Exhalation** — passive, exponential decay (identical mechanism in all three modes, see §4):

```formula
Vol(t) = expStartVol × e^(−t / (R×C))
Flow(t) = −(expStartVol / (R×C)) × e^(−t / (R×C))
Paw = PEEP + Vol/C
```

---

### 2. Ventilator settings — Pressure Control (PC) mode

| Control | Slider range | Variable | Directly affects |
| --- | --- | --- | --- |
| PC above PEEP | 5–35 cmH₂O | `settings.PC.pc` | Target inspiratory pressure |
| Respiratory rate | 5–35 br/min | `settings.PC.rr` | Cycle timing |
| PEEP | 0–20 cmH₂O | `settings.PC.peep` | Baseline pressure |
| FiO₂ | 21–100% | `settings.PC.fio2` | SpO₂/PaO₂ only (§5) |

**Cycle timing:** same as VC (`Ti = totalCycle × 0.35`).

**Inspiration** — pressure-controlled, volume is the result (the mirror image of VC):

```formula
Ptarget = PEEP + PC

Paw rises toward Ptarget on a fast exponential (riseTau = 0.06s):
Paw = Ptarget − (Ptarget − PEEP) × e^(−t/0.06)

drive = Paw − PEEP − Vol/C
Flow = max(drive / R, 0)                        ← flow, and therefore volume, is DERIVED from pressure
Vol += Flow × DT
```

Lower C or higher R lowers VTe; Ppeak is fixed by the setting.

CHECK: expect decrease compliance or increased resistance makes **VTe fall** in PC mode instead of Ppeak rising since the pressure target is fixed by the setting, so the same driving pressure moves less air when the lungs are stiffer or more obstructed.

**Exhalation:** identical passive decay formula as VC (§1/§4).

---

### 3. Ventilator settings — PS/CPAP mode

| Control | Slider range | Variable | Directly affects |
| --- | --- | --- | --- |
| PS above PEEP | 0–30 cmH₂O | `settings.PS.ps` | Pressure support magnitude for patient-triggered breaths |
| PEEP | 0–20 cmH₂O | `settings.PS.peep` | Baseline pressure |
| Backup RR | 4–30 br/min | `settings.PS.backupRR` | Rate when effort = 0 |
| Backup PC above PEEP | 5–35 cmH₂O | `settings.PS.backupPC` | Pressure target when effort = 0 (§3.1) |
| FiO₂ | 21–100% | `settings.PS.fio2` | SpO₂/PaO₂ only (§5) |

Patient Effort (§4), not a ventilator dial, sets cycle timing:

```formula
baseRR = effort > 0
  ? min(28, backupRR × 0.6 + effort × 1.6)
  : backupRR

totalCycle = 60 / max(baseRR, 4)
Ti = totalCycle × 0.32
```

**Inspiration** — pressure target depends on effort:

```formula
Ptarget = effort > 0
  ? PEEP + PS
  : PEEP + backupPC

  Paw = Ptarget − (Ptarget − PEEP) × e^(−t/0.05)

*riseTau = 0.05s, slightly faster than PC mode's 0.06s -- quicker response from patient breath

drive = Paw − PEEP − Vol/C
Flow = max(drive / R, 0) × (effort > 0 ? 1.0 : 0.9)   ← passive/backup breaths get a slightly blunted flow
Vol += Flow × DT
```

**Exhalation:** same decay as other modes, plus a trigger-effort dip in the last 15% of Te when `effort > 0`:

```formula
trigDip = −0.3 × effort × sin(π × progressThroughWindow)
Paw = PEEP + Vol/C + trigDip
```

#### 3.1 Backup pressure target

Apnea backup breaths use `backupPC`, not `PS`. `PS` is an assist pressure on top of the patient's own effort; a backup breath has zero patient effort, so it needs a full pressure-controlled target to move adequate volume. Defaults: PS = 5, backupPC = 15.

Effort dropping to 0 changes two things simultaneously:

- `baseRR` → `backupRR`
- `Ptarget` → `PEEP + backupPC` (visible Ppeak/VTe increase, not just a rate change)

---

### 4. Patient mechanics controls

| Control | Slider range | Variable | Physiologically represents |
| --- | --- | --- | --- |
| Compliance | 10–100 mL/cmH₂O | `patient.compliance` | Lung stretchiness. <br>Low = stiff (ARDS/fibrosis). <br>High = floppy (emphysema). |
| Airway resistance | 4–40 cmH₂O/L/s | `patient.resistance` | Airway narrowing. <br>Low = clear. <br>High = bronchospasm/secretions/COPD. |
| Patient effort | 0–10 | `patient.effort` | How hard the patient is trying to breathe on their own. **Only affects mechanics in PS mode** (§3) — in VC/PC the machine fully controls the breath regardless of this value. |
| Left lung collapsed | checkbox | `patient.leftCollapsed` | Pneumothorax / atelectasis / mainstem intubation of the *right* bronchus |
| Right lung collapsed | checkbox | `patient.rightCollapsed` | Same, opposite side |

#### 4.1 Compliance and resistance

One equation, shared by all modes:

```formula
Paw = PEEP + Vol/C + R × Flow      (active flow)
Paw = PEEP + Vol/C                 (passive exhalation)
```

VC/PC/PS differ in which variable is input vs. output (§1–§3), not in the physics.

**Passive exhalation** is a first-order decay, `τ = R × C`:

```formula
Vol(t) = expStartVol × e^(−t/τ)
Flow(t) = −(expStartVol/τ) × e^(−t/τ)
```

Larger τ (high R, high C) → slower decay → longer exhalation.

#### 4.2 Collapsed lung — effective compliance

Changes which compliance value flows into the equations above:

```formula
effectiveCompliance():
  C = patient.compliance / 1000
  both collapsed:   C × 0.10
  right collapsed:  C × 0.45   (left lung only)
  left collapsed:   C × 0.55   (right lung only)
  else:             C
```

55/45 split reflects the right lung's larger normal volume. This value feeds `Paw = PEEP + Vol/C + R×Flow` directly — Ppeak rises in VC, VTe falls in PC/PS. No separate collapsed-lung branch exists; it's mediated entirely through this substitution.

#### 4.3 Anatomy Visualization Variables

These don't affect Paw/Flow/Vol — they're purely for the visual (SVG or Unity).

`derivedPatientFractions` convert patient and vent parameters to vars that drive the visualization:

```formula
LUNGS
fillFrac        = clamp(Vol / 0.8, 0, 1)                           (0.8 L ≈ visual full-scale)
expGain         = 0.55 + (clamp(C_display,10,100) − 10)/90 × 0.6   (uses displayed C, not effective C)
stiffFrac       = clamp((100 − C_display)/90, 0, 1)                ( 1 = darker, stiff to 0 = pink,normal)

ALVEOLI
alvScale        = 1 + fillFrac × 1.35 × expGain
overDist        = Paw > 30 AND fillFrac > 0.6                      (color change if overextends)

BRONCHIOLE
rFrac           = clamp((R − 4)/36, 0, 1)
bronchioleScale = 1 − rFrac × 0.53

```

These are then used in `updateLungVisual`.

### 5. FiO₂ and gas exchange (SpO₂ / PaCO₂)

FiO₂ does not appear in `step()`. It feeds a separate gas exchange calculation, run once per breath at the insp→exp transition.

#### 5.1 Dependencies

| Signal | Driven by |
| --- | --- |
| SpO₂ / PaO₂ | FiO₂, shunt fraction |
| PaCO₂ | Alveolar minute ventilation (rate × volume) |
| Shunt fraction | Compliance, resistance, collapsed-lung state |

#### 5.2 Calculation

Using GAS EXCHANGE constants for atm pressure, ph...etc.

```formula
vtL = lastVTe / 1000                         (last breath's exhaled volume, L)
rr  = lastRRdisplay                          (measured RR, not just the dial setting)
VA  = max(rr × (vtL − deadSpace), 0.1)       (alveolar minute ventilation, L/min; deadSpace = 0.15L)

shuntFrac = min(0.6,
              stiffFrac × 0.4
            + rFrac × 0.15
            + (either lung collapsed ? 0.25 : 0))

paCO2 = 0.863 × VCO2 / VA                   (VCO2 = 200 mL/min)
paCO2 = clamp(paCO2, 15, 120)

fio2Frac = settings[currentMode].fio2 / 100
PAO2 = fio2Frac × (Patm − PH2O) − paCO2/RQ   (Patm=760, PH2O=47, RQ=0.8)
paO2 = clamp(PAO2 × (1 − shuntFrac), 20, 650)  

spo2 = 100 / (23400/(paO2³ + 150×paO2) + 1)  (Severinghaus approximation)
spo2 = clamp(spo2, 40, 100)
```

#### 5.3 Shunt refractoriness

`shuntFrac` multiplies `PAO2` before it becomes `paO2`. In high-shunt cases (bad compliance, collapsed lung), raising FiO₂ produces a diminishing SpO₂ return — this follows directly from the formula, not a special case.

#### 5.4 Update cadence

Gas exchange values are recalculated **once per completed breath** (at the insp→exp transition), not every 20ms tick like Paw/Flow/Vol. Real pulse oximetry has its own lag too, so per-breath updates are a reasonable approximation and avoid adding this calculation to the 50Hz hot path.

---

### 6. Quick-reference: control → outcome matrix

| If you increase... | Ppeak (VC) | VTe (PC/PS) | Exhalation time | SpO₂ | PaCO₂ |
| --- | --- | --- | --- | --- | --- |
| Tidal volume (VC) | ↑ (more volume, same C/R → more pressure needed) | n/a (VC doesn't have a VTe *target*, it's fixed) | no direct effect | indirect, via VA↑ → PaCO₂↓ → PAO₂↑ | ↓ |
| PC / PS pressure | n/a | ↑ | no direct effect | indirect, via VA↑ | ↓ |
| Respiratory rate | no direct effect | no direct effect | shorter Te (less time to exhale — can cause breath-stacking at extremes) | indirect, via VA↑ | ↓ |
| PEEP | ↑ (baseline shifts up) | ↑ slightly (higher starting point) | no direct effect | no direct effect | no direct effect |
| FiO₂ | none | none | none | ↑ (unless shunt is high) | **none — by design** |
| Compliance (lower = stiffer) | ↑ | ↓ | shorter τ = R×C → faster (unless R also elevated) | ↓ (via ↑ shuntFrac) | slight ↑ (via VA↓ if VTe falls) |
| Resistance (higher) | ↑ (adds R×Flow term directly) | ↓ (less flow gets through per unit pressure) | longer τ = R×C → much slower, classic obstructive pattern | ↓ slightly (via shuntFrac) | ↑ (via VA↓) |
| Patient effort (PS mode only) | n/a | n/a — but drives *rate* up, so more breaths/min | n/a | indirect, via VA↑ (faster rate) | ↓ |
| Collapse a lung | ↑ | ↓ | shorter (lower effective C shortens τ) | ↓ (shunt +0.25 flat penalty) | ↑ (VTe drops, so VA drops) |

---

### 7. To be discussed with SMEs

- **Hemodynamic model, end organ impacts** — cardiac output, interaction between intrathoracic pressure and venous return, effect of PEEP on brain, bp...etc.?
- **Temperature, pH, or full CO₂ transport model** — PaCO₂ here is a simplified alveolar-ventilation-only estimate, not a full metabolic/buffering model.
- **Equipment conditions: leak, disconnect, or alarm conditions.**
