(function () {
  "use strict";

  // ---------------- STATE ----------------
  let mode = "VC"; // VC | PC | PS

  const settings = {
    VC: { fio2: 40, peep: 5.0, rr: 16, tv: 450 },
    PC: { fio2: 40, peep: 8.0, rr: 18, pc: 15 },
    PS: { fio2: 30, peep: 5.0, ps: 5, backupRR: 10, backupPC: 15 },
  };

  const patient = {
    compliance: 50,
    resistance: 10,
    effort: 0,
    leftCollapsed: false,
    rightCollapsed: false,
  };

  // ---------------- GAS EXCHANGE CONSTANTS ----------------
  const GAS = {
    Patm: 760, // mmHg, atmospheric pressure
    PH2O: 47, // mmHg, water vapor pressure at body temp
    RQ: 0.8, // respiratory quotient
    VCO2: 200, // mL/min, resting adult CO2 production
    deadSpace: 0.15, // L, anatomic dead space
  };

  // live gas exchange signals, recomputed once per completed breath
  let spo2 = 98,
    paO2 = 95,
    paCO2 = 40,
    shuntFrac = 0;

  // ---------------- SHARED PATIENT-DERIVED FRACTIONS ----------------
  // Computed once per frame in derivePatientFractions() and reused by the SVG
  // visual, the Unity bridge snapshot, and the gas exchange calculation --
  // avoids recomputing the same numbers three different ways in three places.
  let fillFrac = 0,
    expGain = 0,
    stiffFrac = 0,
    rFrac = 0;
  let alvScale = 0,
    overDist = false;
  // Per-side, already collapse-aware FINAL values -- computed once in
  // derivePatientFractions() and used for visual rendering (SVG + Unity) and for gas exchange (shuntFrac) alike.
  let leftLungFrac = 0,
    rightLungFrac = 0;
  let bronchLWidth = 6,
    bronchRWidth = 6;
  let o2Frac = 0,
    co2Frac = 0;

  // ---------------- DOM ----------------
  const $ = (id) => document.getElementById(id);
  const canvas = $("scopeCanvas");
  const ctx = canvas.getContext("2d");

  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", fitCanvas);

  // ---------------- SIM CLOCK ----------------
  const FS = 50; // sim steps per second
  const DT = 1 / FS;
  let simTime = 0;

  // breath state machine
  let phase = "insp"; // insp | exp
  let phaseTime = 0;

  // live signals (current instantaneous values)
  let Paw = 0,
    Flow = 0,
    Vol = 0; // cmH2O, L/min, mL
  let lastVTe = 0,
    lastVTi = 0,
    lastPpeak = 0,
    lastRRdisplay = 16;

  // history buffer for scrolling traces (3 panels)
  const HIST_SECONDS = 8;
  const histLen = HIST_SECONDS * FS;
  const hPaw = new Float32Array(histLen);
  const hFlow = new Float32Array(histLen);
  const hVol = new Float32Array(histLen);
  let histIdx = 0;

  function pushHist(p, f, v) {
    hPaw[histIdx] = p;
    hFlow[histIdx] = f;
    hVol[histIdx] = v;
    histIdx = (histIdx + 1) % histLen;
  }

  // captured exactly once at the insp->exp transition: the starting volume for this breath's exhale decay
  let expStartVol = 0;

  // ---------------- COLLAPSED LUNG (effective compliance) ----------------
  // Two lungs in parallel roughly add their compliance. Taking one offline
  // (pneumothorax, complete atelectasis, mainstem intubation) doesn't change
  // patient.compliance itself -- it changes how much of it is still usable.
  // This is what makes Ppeak rise (VC) / VTe fall (PC) with a collapsed lung,
  // same mechanism as any other compliance-lowering condition already modeled.
  // Right lung is given the larger share (~55/45) to reflect its larger normal
  // volume (left lung is smaller due to the cardiac notch).
  function effectiveCompliance() {
    const C = patient.compliance / 1000; // mL/cmH2O -> L/cmH2O
    if (patient.leftCollapsed && patient.rightCollapsed) return C * 0.1; // both down -- extreme edge case, not zero to avoid divide-by-zero blowups
    if (patient.rightCollapsed) return C * 0.45; // only left (smaller) lung ventilating
    if (patient.leftCollapsed) return C * 0.55; // only right (larger) lung ventilating
    return C;
  }

  // ---------------- PHYSIOLOGY STEP ----------------
  // Single compartment: Paw = PEEP + V/C + R*Flow  (Flow in L/s, V in L, R in cmH2O/L/s)
  function step() {
    const C = effectiveCompliance(); // L/cmH2O, accounts for any collapsed lung
    const R = patient.resistance; // cmH2O/L/s
    const effort = patient.effort; // 0-10

    if (mode === "VC") {
      const s = settings.VC;
      const totalCycle = 60 / s.rr;
      const Ti = totalCycle * 0.35; // I:E ~ 1:2 in real practice; simplified fixed 35% here for visual clarity
      const Te = totalCycle - Ti;
      const targetVL = s.tv / 1000;

      if (phase === "insp") {
        // decelerating-ish square flow to mimic image: near-constant flow producing volume ramp
        const peakFlowLs = (targetVL / Ti) * 2; // L/s,  higher than mean to ramp down to zero at end of inspiration
        const frac = phaseTime / Ti;
        let f = peakFlowLs * (1 - frac); // ramp down (flat) across rest of inspiration

        Flow = Math.max(f, 0);

        Vol += Vol < targetVL ? Flow * DT : 0;

        Paw = s.peep + Vol / C + R * Flow;
        if (phaseTime >= Ti) {
          phase = "exp";
          phaseTime = 0;
          lastVTi = Math.round(Vol * 1000);
          expStartVol = Vol; // capture once at the moment exhalation begins
        }
      } else {
        // passive exhalation: exponential decay from the fixed starting volume of this breath
        const tau = R * C;
        const v0 = expStartVol;
        Vol = v0 * Math.exp(-phaseTime / Math.max(tau, 0.05));
        Flow =
          -(v0 / Math.max(tau, 0.05)) *
          Math.exp(-phaseTime / Math.max(tau, 0.05));
        Paw = s.peep + Vol / C;
        if (phaseTime >= Te) {
          lastVTe = Math.round(v0 * 1000);
          phase = "insp";
          phaseTime = 0;
          Vol = 0;
        }
      }
    } else if (mode === "PC") {
      const s = settings.PC;
      const totalCycle = 60 / s.rr;
      const Ti = totalCycle * 0.35;
      const Te = totalCycle - Ti;
      const Ptarget = s.peep + s.pc;

      if (phase === "insp") {
        const riseTau = 0.06;
        Paw = Ptarget - (Ptarget - s.peep) * Math.exp(-phaseTime / riseTau);
        const drive = Paw - s.peep - Vol / C;
        Flow = Math.max(drive / Math.max(R, 1), 0);
        Vol += Flow * DT;
        if (phaseTime >= Ti) {
          phase = "exp";
          phaseTime = 0;
          lastVTi = Math.round(Vol * 1000);
          expStartVol = Vol;
        }
      } else {
        const tau = R * C;
        const v0 = expStartVol;
        Vol = v0 * Math.exp(-phaseTime / Math.max(tau, 0.05));
        Flow =
          -(v0 / Math.max(tau, 0.05)) *
          Math.exp(-phaseTime / Math.max(tau, 0.05));
        Paw = s.peep + Vol / C;
        if (phaseTime >= Te) {
          lastVTe = Math.round(v0 * 1000);
          phase = "insp";
          phaseTime = 0;
          Vol = 0;
        }
      }
    } else if (mode === "PS") {
      const s = settings.PS;
      // Patient-triggered breaths get a modest assist pressure (PS) -- the
      // patient is doing most of the work. Backup/apnea breaths (effort=0,
      // no trigger detected) get backupPC instead: the machine is now doing
      // the entire breath on its own, so it needs a full pressure-controlled
      // target, not just an assist bump. This mirrors real ventilator
      // behavior, where apnea backup is effectively a PC breath, not PS
      // with a timer.
      const Ptarget = effort > 0 ? s.peep + s.ps : s.peep + s.backupPC;
      // spontaneous-ish cycling: rate driven by effort (more effort -> faster, more variable)
      const baseRR =
        effort > 0 ? Math.min(28, s.backupRR * 0.6 + effort * 1.6) : s.backupRR;
      const totalCycle = 60 / Math.max(baseRR, 4);
      const Ti = totalCycle * 0.32;
      const Te = totalCycle - Ti;

      if (phase === "insp") {
        const riseTau = 0.05;
        Paw = Ptarget - (Ptarget - s.peep) * Math.exp(-phaseTime / riseTau);
        const drive = Paw - s.peep - Vol / C;
        Flow = Math.max(drive / Math.max(R, 1), 0) * (effort > 0 ? 1.0 : 0.9);
        Vol += Flow * DT;
        // early termination (flow cycle-off) when flow decays - simplified by Ti
        if (phaseTime >= Ti) {
          phase = "exp";
          phaseTime = 0;
          lastVTi = Math.round(Vol * 1000);
          expStartVol = Vol;
        }
      } else {
        const tau = R * C;
        const v0 = expStartVol;
        Vol = v0 * Math.exp(-phaseTime / Math.max(tau, 0.05));
        Flow =
          -(v0 / Math.max(tau, 0.05)) *
          Math.exp(-phaseTime / Math.max(tau, 0.05));
        // small negative deflection at end-exhalation if effort>0 (patient trigger)
        let trigDip = 0;
        if (effort > 0) {
          const triggerWindow = Te * 0.85;
          if (phaseTime > triggerWindow) {
            const tFrac =
              (phaseTime - triggerWindow) / (Te - triggerWindow + 1e-6);
            trigDip = -0.3 * effort * Math.sin(Math.min(tFrac, 1) * Math.PI);
          }
        }
        Paw = s.peep + Vol / C + trigDip;
        if (phaseTime >= Te) {
          lastVTe = Math.round(v0 * 1000);
          phase = "insp";
          phaseTime = 0;
          Vol = 0;
        }
      }
    }

    phaseTime += DT;
    simTime += DT;
  }

  // We track Ppeak per-breath separately and reset cleanly:
  let breathPpeak = 0;
  // Peak |flow| spans a full breath cycle (both the inspiratory push and the
  // expiratory decay peak right after insp ends), so it's accumulated
  // unconditionally each tick and finalized at the *next* breath's start
  // rather than gated to a single phase like breathPpeak is.
  let breathPeakFlowAbs = 0;
  let prevPhase = "insp";
  let lastBreathTimes = [];

  function trackAndDetectBoundary() {
    if (phase === "insp") {
      breathPpeak = Math.max(breathPpeak, Paw);
    }
    breathPeakFlowAbs = Math.max(breathPeakFlowAbs, Math.abs(Flow * 60)); // L/min, matches the flow panel's units

    const expStarted = prevPhase === "insp" && phase === "exp";
    const inspStarted = prevPhase === "exp" && phase === "insp";

    if (expStarted) {
      lastPpeak = breathPpeak;
      breathPpeak = 0;
      updateGasExchange();
      pushAutoscaleSample("paw", lastPpeak);
      pushAutoscaleSample("vol", lastVTi);
    }
    if (inspStarted) {
      pushAutoscaleSample("flow", breathPeakFlowAbs);
      breathPeakFlowAbs = 0;
      lastBreathTimes.push(simTime);
      if (lastBreathTimes.length > 6) lastBreathTimes.shift();
      if (lastBreathTimes.length >= 2) {
        const intervals = [];
        for (let i = 1; i < lastBreathTimes.length; i++)
          intervals.push(lastBreathTimes[i] - lastBreathTimes[i - 1]);
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        lastRRdisplay = Math.round(60 / avg);
      }
    }
    prevPhase = phase;
  }

  // ---------------- MAIN LOOP ----------------
  let lastFrameWall = performance.now();
  let accum = 0;

  function loop() {
    const now = performance.now();
    let dtWall = (now - lastFrameWall) / 1000;
    lastFrameWall = now;
    dtWall = Math.min(dtWall, 0.1);
    accum += dtWall;

    while (accum >= DT) {
      step();
      trackAndDetectBoundary();
      pushHist(Paw, Flow * 60, Vol * 1000); // flow displayed L/min, vol displayed mL
      accum -= DT;
    }

    renderGraphs();
    updateReadouts();

    derivePatientFractions(); // single source of truth for both visualizations below
    updateVisuals();
    requestAnimationFrame(loop);
  }

  // ---------------- RENDER ----------------
  // ---------------- SCOPE AUTOSCALE ----------------
  // Resize each waveform panel off recent breath history
  // rather than a fixed range picked at ventilator-setup time.
  // Avoids traces clipping off-panel for any setting combination
  // that produces an unusually large breath (e.g. a high backup PC in PS
  // mode).
  const AUTOSCALE_BREATHS = 3; // rolling window, in completed breaths
  const AUTOSCALE_EASE = 0.06; // per-frame ease toward target -- avoids the axis visibly snapping at each breath boundary
  const autoscale = {
    paw: { floor: 40, pad: 1.1, recent: [], target: 40, display: 40 },
    flow: { floor: 100, pad: 1.1, recent: [], target: 100, display: 100 }, // symmetric +/-
    vol: { floor: 600, pad: 1.3, recent: [], target: 600, display: 600 },
  };

  function pushAutoscaleSample(kind, peakAbsValue) {
    const a = autoscale[kind];
    a.recent.push(peakAbsValue);
    if (a.recent.length > AUTOSCALE_BREATHS) a.recent.shift();
    a.target = Math.max(a.floor, Math.max(...a.recent) * a.pad);
  }

  function easedAutoscale(kind) {
    const a = autoscale[kind];
    a.display += (a.target - a.display) * AUTOSCALE_EASE;
    return a.display;
  }

  function renderGraphs() {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const panelH = h / 3;
    drawGraphPanel(
      0,
      panelH,
      hPaw,
      scaleFor("paw"),
      "#e8a43d",
      "Paw cmH\u2082O",
      scaleLabels("paw"),
    );
    drawGraphPanel(
      panelH,
      panelH,
      hFlow,
      scaleFor("flow"),
      "#5fcf86",
      "FLOW l/min",
      scaleLabels("flow"),
    );
    drawGraphPanel(
      panelH * 2,
      panelH,
      hVol,
      scaleFor("vol"),
      "#5cc9da",
      "V ml",
      scaleLabels("vol"),
      true,
    );

    // divider lines
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, panelH);
    ctx.lineTo(w, panelH);
    ctx.moveTo(0, panelH * 2);
    ctx.lineTo(w, panelH * 2);
    ctx.stroke();
  }

  function scaleFor(kind) {
    if (kind === "paw") return { min: -5, max: easedAutoscale("paw") };
    if (kind === "flow") {
      const m = easedAutoscale("flow");
      return { min: -m, max: m };
    }
    if (kind === "vol") return { min: 0, max: easedAutoscale("vol") };
  }
  function scaleLabels(kind) {
    const sc = scaleFor(kind);
    return { top: Math.round(sc.max), bottom: Math.round(sc.min) };
  }

  function drawGraphPanel(
    yTop,
    panelH,
    hist,
    scale,
    color,
    label,
    labels,
    baseline0,
  ) {
    const w = canvas.clientWidth;
    const padTop = 14,
      padBottom = 6;
    const innerH = panelH - padTop - padBottom;

    function yFor(val) {
      const t = (val - scale.min) / (scale.max - scale.min);
      return yTop + padTop + innerH * (1 - t);
    }

    // gridline at zero / baseline
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    const zeroY = yFor(baseline0 ? scale.min : 0);
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(w, zeroY);
    ctx.stroke();

    // trace
    const n = histLen;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const idx = (histIdx + i) % n; // oldest..newest across buffer
      const x = (i / n) * w;
      const y = yFor(hist[idx]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // label
    ctx.fillStyle = "#8c9094";
    ctx.font = "10px IBM Plex Mono, monospace";
    ctx.fillText(String(labels.top), 4, yTop + 11);
    ctx.fillText(String(labels.bottom), 4, yTop + panelH - 3);
    ctx.fillStyle = "#aeb1b4";
    ctx.font = "11px IBM Plex Mono, monospace";
    ctx.fillText(label, 22, yTop + 11);
  }

  // ---------------- GAS EXCHANGE ----------------
  // FiO2 does NOT affect lung mechanics (compliance/resistance/inflation) --
  // physiologically it only affects how much oxygen is available to diffuse
  // into blood. This is a deliberately simplified model (illustrative, not a
  // clinical calculator) that ties oxygenation to variables the sim already
  // tracks, so a collapsed lung / bad compliance / bad resistance naturally
  // produces worse oxygenation without needing separate new sliders.
  function updateGasExchange() {
    
    const PEEP = settings[mode].peep;
    // local copy, not the shared module-scope stiffFrac -- avoids depending on
    // derivePatientFractions() having already run this tick (see PEEP/shunt discussion)
    const stiffFracLocal = Math.max(0, Math.min(1, (100 - patient.compliance) / 90));

    // Stiffer lungs need MORE PEEP before recruitment kicks in (collapsed units
    // in ARDS take real pressure to reopen), but ALSO have MORE recruitable
    // shunt available once they do -- so both the threshold and the max benefit
    // scale with stiffFrac. A normal lung (stiffFrac~0) has little shunt to
    // recruit in the first place, so this term stays small regardless.
    const recruitThreshold = 5 + stiffFracLocal * 10;   // 5 cmH2O (normal) -> 15 cmH2O (severe)
    const recruitMaxBenefit = 0.08 + stiffFracLocal * 0.12; // 0.08 (normal) -> 0.20 (severe)
    const peepRecruitBenefit = recruitMaxBenefit * (1 - Math.exp(-Math.max(0, PEEP - recruitThreshold) / 6));

    // Stiffer (ARDS): only a fraction of the lung is aerated, 
    // the SAME pressure that's still trying to recruit
    // collapsed regions is overdistending the already-open ones --
    // overdistension onset drops as stiffFrac rises.
    const overdistensionOnset = 16 - stiffFracLocal * 6; // 16 cmH2O (normal) -> 10 cmH2O (severe)
    const peepOverdistensionPenalty = 0.08 *
      Math.max(0, Math.min(1, (PEEP - overdistensionOnset) / 10));

    shuntFrac = Math.min(0.6, Math.max(0,
        stiffFracLocal * 0.4
      + rFrac * 0.15
      + (patient.leftCollapsed || patient.rightCollapsed ? 0.25 : 0)
      - peepRecruitBenefit
      + peepOverdistensionPenalty
    ));
    
    const vtL = lastVTe / 1000;
    const rr = lastRRdisplay || 1;
    const VA_Lmin = Math.max(rr * (vtL - GAS.deadSpace), 0.1); // alveolar minute ventilation
    // CO2 is driven by ventilation, NOT FiO2 -- keeping these independent
    paCO2 = (0.863 * GAS.VCO2) / VA_Lmin; // alveolar ventilation equation
    paCO2 = Math.min(Math.max(paCO2, 15), 120);

    // Alveolar gas equation, then reduce by shunt to get an effective PaO2.
    const fio2Frac = settings[mode].fio2 / 100;
    const PAO2 = fio2Frac * (GAS.Patm - GAS.PH2O) - paCO2 / GAS.RQ;
    paO2 = Math.min(Math.max(PAO2 * (1 - shuntFrac), 20), 650);

    // Severinghaus approximation of the oxyhemoglobin dissociation curve.
    spo2 = 100 / (23400 / (Math.pow(paO2, 3) + 150 * paO2) + 1);
    spo2 = Math.min(Math.max(spo2, 40), 100);
  }

  // ---------------- SHARED PATIENT-DERIVED FRACTIONS ----------------
  // Single source of truth for the numbers driven by compliance/resistance/
  // volume/gas-exchange -- fractions for the visualizations and the gas exchange model  
  // runs every frame after step() has updated Paw/Vol/Flow, but before either visualizer reads the values.
  function derivePatientFractions() {
    const C = patient.compliance;
    const R = patient.resistance;
    const nominalMaxL = 0.8; // 800 mL ~ visual full-scale

    fillFrac = Math.max(0, Math.min(1, Vol / nominalMaxL));
    expGain = 1 + ((Math.min(Math.max(C, 10), 100) - 10) / 90) * 0.6;
    stiffFrac = Math.max(0, Math.min(1, (100 - C) / 90));
    rFrac = Math.max(0, Math.min(1, (R - 4) / 36));

    alvScale = 1 + fillFrac * 1.35 * expGain;
    overDist = Paw > 30 && fillFrac > 0.6;

    // Per-side lung inflation fraction, already collapse-aware. 
    leftLungFrac = patient.leftCollapsed ? 0 : fillFrac * expGain;
    rightLungFrac = patient.rightCollapsed ? 0 : fillFrac * expGain;

    // Per-side bronchus width, already collapse-aware. 
    const BRONCH_OPEN_WIDTH = 6 - rFrac * 3.2; // narrows as resistance climbs
    const BRONCH_OCCLUDED_WIDTH = 1.8;
    bronchLWidth = patient.leftCollapsed ? BRONCH_OCCLUDED_WIDTH : BRONCH_OPEN_WIDTH;
    bronchRWidth = patient.rightCollapsed ? BRONCH_OCCLUDED_WIDTH : BRONCH_OPEN_WIDTH;

    // Gas exchange dot/particle intensity. 
    // SpO2: plateau at full intensity across the clinically-acceptable
    // range (>=90%, the standard "keep SpO2 >=90" target, then a narrow, steep ramp down to 0 by 70%
    // (severe hypoxemia). Narrow ramp = obvious change per point of
    // desaturation, rather than a shallow gradient across the full sim range.
    o2Frac = spo2 >= 90 ? 1 : Math.max(0, (spo2 - 70) / 20);

    // PaCO2: flat, dim baseline across the normal range (35-45 mmHg) --
    // normal CO2 clearance shouldn't read as alarming. Ramps up toward full
    // intensity in EITHER direction outside normal: above 45 toward 80
    // (hypercapnia/retention, the common case in ARDS/COPD/collapsed-lung
    // scenarios here), or below 35 toward 20 (hypocapnia/hyperventilation).
    const CO2_BASELINE = 0.2;
    if (paCO2 >= 35 && paCO2 <= 45) {
      co2Frac = CO2_BASELINE;
    } else if (paCO2 > 45) {
      co2Frac = CO2_BASELINE + (1 - CO2_BASELINE) * Math.min(1, (paCO2 - 45) / (80 - 45));
    } else {
      co2Frac = CO2_BASELINE + (1 - CO2_BASELINE) * Math.min(1, (35 - paCO2) / (35 - 20));
    }
  }

  // ---------------- READOUTS ----------------
  
  // The readouts of the ventilator panel
  function updateReadouts() {
    $("vPpeak").textContent = lastPpeak > 0 ? lastPpeak.toFixed(0) : "--";
    $("vRR").textContent = lastRRdisplay;
    const mv = (lastVTe / 1000) * lastRRdisplay;
    $("vMV").textContent = mv.toFixed(1);
    $("vVTi").textContent = lastVTi || "--";
    $("vVTe").textContent = lastVTe || "--";
  }

  // The numbers printed to lung panel patient model readouts 
  // .lp-readout elements, name convention: lpComp, lpRes, lpSpo2, lpPaCO2, etc. 
  let lpSpo2Last = null,
      lpPaCO2Last = null;
  function UpdateLungPanelReadouts() {
    const C = patient.compliance;
    const R = patient.resistance;

    let lpCompLast = null,
        lpResLast = null;
    let lpLeftCollapsedLast = false,
        lpRightCollapsedLast = false;
    
    // compliance / collapse-state text + color refresh -- only touches the
    // DOM when compliance or either collapse flag actually changed, rather
    // than reapplying identical style strings every 20ms tick.
    if (
      C !== lpCompLast ||
      patient.leftCollapsed !== lpLeftCollapsedLast ||
      patient.rightCollapsed !== lpRightCollapsedLast
    ) {
      $("lpComp").textContent = C;
      lpCompLast = C;
      lpLeftCollapsedLast = patient.leftCollapsed;
      lpRightCollapsedLast = patient.rightCollapsed;
    }
    if (R !== lpResLast) {
      $("lpRes").textContent = R;
      lpResLast = R;
    }

    // update .lp-readout
    const spo2El = $("lpSpO2");
    if (spo2El) spo2El.textContent = spo2.toFixed(0);
    const co2El = $("lpPaCO2");
    if (co2El) co2El.textContent = paCO2.toFixed(0);

    lpSpo2Last = spo2;
    lpPaCO2Last = paCO2;

  }

  // ---------------- LUNG/MODEL VISUAL ----------------

  const COLLAPSED_SCALE = 0.78;
  // collapsed lung tint (converted from rgb(130,128,124))
  const COLLAPSED_COLOR = 1042;   // degrees
  const COLLAPSED_BRIGHTNESS = 0.7;
  // Convert your RGB interpolation into a hue-rotate angle
  function tissueColor(frac) {
      const lo = [155, 3, 35];   // darker stiffened red
      const hi = [255, 0, 0]; // healthy light pink

      const mix = lo.map((v, i) => Math.round(v + (hi[i] - v) * (1 - frac)));

      // Convert RGB → hue angle (0–360)
      const r = mix[0] / 255;
      const g = mix[1] / 255;
      const b = mix[2] / 255;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;

      let h = 0;

      if (d !== 0) {
          if (max === r) {
              h = ((g - b) / d) % 6;
          } else if (max === g) {
              h = (b - r) / d + 2;
          } else {
              h = (r - g) / d + 4;
          }
          h *= 60;
          if (h < 0) h += 360;
      }

      return h*3;  // degrees for hue-rotate()
  }
  function Update2DVisual() {
    // NOTE: fillFrac, expGain, stiffFrac, rFrac, alvScale, overDist,
    // leftLungFrac/rightLungFrac, bronchLWidth/bronchRWidth, o2Frac/co2Frac
    // are all computed once per frame in derivePatientFractions() (called
    // from loop(), before this runs)
    
    /* LUNGS */
    const lungL = $("lungL"),
          lungR = $("lungR");
    const lungLimg = document.getElementById('lungLimg');
    const lungRimg = document.getElementById('lungRimg');
        
    const lungScale = 1 + fillFrac * 0.22 * expGain;
    const breathingBrightness = 1.7 - rFrac * 0.5 - stiffFrac * 0.5; // darker as resistance or stiffness rises 
    
    apply2DLungSide(lungL, lungLimg, patient.leftCollapsed, lungScale, breathingBrightness);
    apply2DLungSide(lungR, lungRimg, patient.rightCollapsed, lungScale, breathingBrightness);

    /* BRONCHI */

    // resistance -> visually narrow / thicken & darken the airway (bronchi).
    // resistance number; bronchWidth here is just its SVG stroke-width rendering.
    const bronchWidth = 6 - rFrac * 3.2; // narrows as resistance climbs
    // BRONCHI left, right
    const bronchL = $("bronchL"), 
          bronchR = $("bronchR");
    const OCCLUDED_COLOR = "#5c5852";
    const bronchColor = rFrac > 0.5 ? "#8a5147" : "#c98a78";
    
    bronchL.setAttribute("stroke-width", bronchWidth.toFixed(1));
    bronchL.style.stroke = patient.leftCollapsed ? OCCLUDED_COLOR : bronchColor;
    bronchR.setAttribute("stroke-width", bronchWidth.toFixed(1));
    bronchR.style.stroke = patient.rightCollapsed
      ? OCCLUDED_COLOR
      : bronchColor;
    
    /* ALVEOLI */
    const alvCircles = document.querySelectorAll(".alv");
    const o2Circles = document.querySelectorAll(".gas-dot-o2");
    const co2Circles = document.querySelectorAll(".gas-dot-co2");
    const gasExchangeGroup = $("gasExchange");

     /* ALVEOLI */
    // Check shunt fraction, shuntFrac, to determine how many alveoli are "open" (pink) vs "closed" (grey). 
    // - visual cue for the user to see how much of the lung is effectively participating in gas exchange.
    const openAlvCount = Math.round((1 - shuntFrac) * alvCircles.length);
    alvCircles.forEach((c, i) => {
      if (i < openAlvCount) {
        c.style.transform = `scale(${alvScale.toFixed(4)})`;

        // Paw overdistension cue: alveoli flush warning-amber if pressure climbs high while near full inflation
        c.style.fill = overDist ? "#e0a23d" : "#e8978a";

        // turn on corresponding gas dots
        o2Circles[i].classList.remove("collapsed");
        co2Circles[i].classList.remove("collapsed");

      }else {
        c.style.transform = `scale(${COLLAPSED_SCALE})`;
        c.style.fill = `hsl(${COLLAPSED_COLOR}, 20%, 50%)`;
        o2Circles[i].classList.add("collapsed");
        co2Circles[i].classList.add("collapsed");
      }

    });

    // O2/CO2 exchange dot intensity -- spo2/paCO2 only change once per
    // breath (updateGasExchange(), at the insp->exp transition), so gate the
    // DOM write the same way the C/R readouts above do.

    if (gasExchangeGroup && (spo2 !== lpSpo2Last || paCO2 !== lpPaCO2Last)) {
      
      gasExchangeGroup.style.setProperty("--o2-intensity", o2Frac.toFixed(2));
      gasExchangeGroup.style.setProperty("--co2-intensity", co2Frac.toFixed(2));

      // O2/CO2 exchange dot anim duration. This is purely visual, not physiologic.
      const DUR_MAX = 5,
            DUR_MIN = 1.0;
      const o2Dur = DUR_MAX - (DUR_MAX - DUR_MIN) * o2Frac;
      const co2Dur = DUR_MAX - (DUR_MAX - DUR_MIN) * co2Frac;
      gasExchangeGroup.style.setProperty(
        "--o2-duration",
        o2Dur.toFixed(2) + "s",
      );
      gasExchangeGroup.style.setProperty(
        "--co2-duration",
        co2Dur.toFixed(2) + "s",
      );
    }

    UpdateLungPanelReadouts();
  }
  function apply2DLungSide(
    lungEl,
    imgEl,
    collapsed,
    normalScale,
    normalBrightness,
  ) {
    if (collapsed) {
      lungEl.style.transform = `scale(${COLLAPSED_SCALE})`;
      imgEl.style.filter =
        `hue-rotate(${COLLAPSED_COLOR}deg) brightness(${COLLAPSED_BRIGHTNESS})`;
    } else {
      lungEl.style.transform = `scale(${normalScale.toFixed(4)})`;
      imgEl.style.filter =
        `hue-rotate(${tissueColor(stiffFrac)}deg) brightness(${normalBrightness.toFixed(3)})`;
        //console.log(`tissueColor(stiffFrac): ${tissueColor(stiffFrac)}deg, brightness: ${normalBrightness.toFixed(3)}`);
    }
  }

  function updateVisuals() {
    // check if Unity ready (Unity WebGL sets a global variable when the engine is initialized)
    const unityReady = window.VentUnityBridge && window.VentUnityBridge.isReady();
    if (unityReady) {
      // Unity-specific rendering logic here
      
    } else {
      // Fallback 2D rendering logic here
      Update2DVisual();
    }
  }

  // ---------------- SETTINGS BAR (device bottom strip) ----------------
  function renderSettingsBar() {
    const bar = $("settingsBar");
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
    bar.innerHTML = tiles
      .map(
        (t) =>
          `<div class="settile" data-key="${t[0]}"><div class="lbl">${t[0].replace("\n", "<br>")}</div><div class="val">${t[1]}</div></div>`,
      )
      .join("");
  }

  function flashSettingsBar() {
    const bar = $("settingsBar");
    bar.querySelectorAll(".settile").forEach((el) => {
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    });
  }

  const modeNotes = {
    VC: "<b>Volume Control:</b> you set tidal volume + rate; the vent delivers a fixed flow pattern and <b>pressure is the result</b> — watch Ppeak rise as compliance drops or resistance climbs.",
    PC: "<b>Pressure Control:</b> you set a pressure target above PEEP; the vent holds that pressure and <b>volume is the result</b> — watch VTe fall if compliance drops, even though pressure stays fixed.",
    PS: "<b>PS/CPAP:</b> the patient triggers each breath; the vent only supports it with a fixed pressure boost. Raise <b>patient effort</b> to see spontaneous triggering, or set effort to 0 to see backup (apnea) breaths take over.",
  };

  // ---------------- WIRE UP UI ----------------
  function switchMode(m) {
    mode = m;
    document
      .querySelectorAll(".modebtn[data-mode]")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    $("vcGroup").style.display = m === "VC" ? "" : "none";
    $("pcGroup").style.display = m === "PC" ? "" : "none";
    $("psGroup").style.display = m === "PS" ? "" : "none";

    renderSettingsBar();
    $("modeNote").innerHTML = modeNotes[m];
    // reset breath state for a clean transition
    phase = "insp";
    phaseTime = 0;
    Vol = 0;
    breathPpeak = 0;
    breathPeakFlowAbs = 0;
    expStartVol = 0;
    lastVTe = 0;
    lastVTi = 0;
    lastBreathTimes = [];
  }

  document.querySelectorAll(".modebtn[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => switchMode(btn.dataset.mode));
  });

  // Deck tabs
  document.querySelectorAll(".deck-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      document.querySelectorAll(".deck-tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
        panel.style.display = panel.dataset.tabPanel === target ? "" : "none";
      });
    });
  });

  // ---------------- CONTROL FIELD REGISTRY ----------------
  // Single source of truth for every slider/checkbox <-> state mapping.
  // Binding (below), preset application (setPatient), and save/load
  // (serializeState/applyState/refreshControlsUI) all read this same list
  // instead of maintaining three separate hardcoded field lists that could
  // drift out of sync as controls are added.
  const SLIDER_FIELDS = [
    {
      sliderId: "sFiO2",
      readoutId: "rFiO2",
      store: settings.VC,
      key: "fio2",
      isFloat: false,
      isVentilatorSetting: true,
    },
    {
      sliderId: "sPEEPvc",
      readoutId: "rPEEPvc",
      store: settings.VC,
      key: "peep",
      isFloat: true,
      isVentilatorSetting: true,
    },
    {
      sliderId: "sRRvc",
      readoutId: "rRRvc",
      store: settings.VC,
      key: "rr",
      isFloat: false,
      isVentilatorSetting: true,
    },
    {
      sliderId: "sTV",
      readoutId: "rTV",
      store: settings.VC,
      key: "tv",
      isFloat: false,
      isVentilatorSetting: true,
    },

    {
      sliderId: "sFiO2pc",
      readoutId: "rFiO2pc",
      store: settings.PC,
      key: "fio2",
      isFloat: false,
      isVentilatorSetting: true,
    },
    {
      sliderId: "sPEEPpc",
      readoutId: "rPEEPpc",
      store: settings.PC,
      key: "peep",
      isFloat: true,
      isVentilatorSetting: true,
    },
    {
      sliderId: "sRRpc",
      readoutId: "rRRpc",
      store: settings.PC,
      key: "rr",
      isFloat: false,
      isVentilatorSetting: true,
    },
    {
      sliderId: "sPC",
      readoutId: "rPC",
      store: settings.PC,
      key: "pc",
      isFloat: false,
      isVentilatorSetting: true,
    },

    {
      sliderId: "sFiO2ps",
      readoutId: "rFiO2ps",
      store: settings.PS,
      key: "fio2",
      isFloat: false,
      isVentilatorSetting: true,
    },
    {
      sliderId: "sPEEPps",
      readoutId: "rPEEPps",
      store: settings.PS,
      key: "peep",
      isFloat: true,
      isVentilatorSetting: true,
    },
    {
      sliderId: "sPS",
      readoutId: "rPS",
      store: settings.PS,
      key: "ps",
      isFloat: false,
      isVentilatorSetting: true,
    },
    {
      sliderId: "sBackupRR",
      readoutId: "rBackupRR",
      store: settings.PS,
      key: "backupRR",
      isFloat: false,
      isVentilatorSetting: true,
    },
    {
      sliderId: "sBackupPC",
      readoutId: "rBackupPC",
      store: settings.PS,
      key: "backupPC",
      isFloat: false,
      isVentilatorSetting: true,
    },

    {
      sliderId: "sComp",
      readoutId: "rComp",
      store: patient,
      key: "compliance",
      isFloat: false,
    },
    {
      sliderId: "sRes",
      readoutId: "rRes",
      store: patient,
      key: "resistance",
      isFloat: false,
    },
    {
      sliderId: "sEffort",
      readoutId: "rEffort",
      store: patient,
      key: "effort",
      isFloat: false,
      fmt: (v) => (v === 0 ? "0 (none)" : v),
    },
  ];

  const CHECKBOX_FIELDS = [
    { id: "chkLeftCollapsed", key: "leftCollapsed" },
    { id: "chkRightCollapsed", key: "rightCollapsed" },
  ];

  function bindSlider(f) {
    const el = $(f.sliderId);
    if (!el) return;
    el.addEventListener("input", () => {
      const v = f.isFloat ? parseFloat(el.value) : parseInt(el.value, 10);
      f.store[f.key] = v;
      $(f.readoutId).textContent = f.fmt
        ? f.fmt(v)
        : f.isFloat
          ? v.toFixed(1)
          : v;
      if (f.isVentilatorSetting) {
        renderSettingsBar();
        flashSettingsBar();
      }
    });
  }
  SLIDER_FIELDS.forEach(bindSlider);

  function bindCheckbox(f) {
    const el = $(f.id);
    if (!el) return; // tolerate markup not being present yet
    el.addEventListener("change", () => {
      patient[f.key] = el.checked;
    });
  }
  CHECKBOX_FIELDS.forEach(bindCheckbox);

  // Pushes current settings/patient state into every bound slider/checkbox's
  // DOM (value + readout text) -- used after a preset, a Load, or the
  // settings.json auto-load, so the UI always matches the underlying state.
  function refreshControlsUI() {
    SLIDER_FIELDS.forEach((f) => {
      const el = $(f.sliderId);
      if (!el) return;
      const v = f.store[f.key];
      el.value = v;
      $(f.readoutId).textContent = f.fmt
        ? f.fmt(v)
        : f.isFloat
          ? Number(v).toFixed(1)
          : v;
    });
    CHECKBOX_FIELDS.forEach((f) => {
      const el = $(f.id);
      if (!el) return;
      el.checked = !!patient[f.key];
    });
    renderSettingsBar();
  }

  const presetSelect = $("presetSelect");
  if (presetSelect) {
    presetSelect.addEventListener("change", () => {
      const p = presetSelect.value;
      if (p === "normal") {
        setPatient(50, 4, 0);
      }
      if (p === "ards") {
        setPatient(22, 16, 0);
      }
      if (p === "copd") {
        setPatient(60, 32, 0);
      }
      if (p === "spontaneous") {
        setPatient(50, 10, 6);
        switchMode("PS");
      }
      presetSelect.value = ""; // reset to placeholder so re-selecting the same preset again still fires change
    });
  }
  function setPatient(c, r, e) {
    patient.compliance = c;
    patient.resistance = r;
    patient.effort = e;
    refreshControlsUI();
  }

  // ---------------- SAVE / LOAD SNAPSHOT ----------------
  function serializeState() {
    return {
      version: 1,
      mode: mode,
      settings: {
        VC: { ...settings.VC },
        PC: { ...settings.PC },
        PS: { ...settings.PS },
      },
      patient: { ...patient },
    };
  }

  function applyState(data) {
    if (!data || typeof data !== "object") return;
    if (data.settings) {
      if (data.settings.VC) Object.assign(settings.VC, data.settings.VC);
      if (data.settings.PC) Object.assign(settings.PC, data.settings.PC);
      if (data.settings.PS) Object.assign(settings.PS, data.settings.PS);
    }
    if (data.patient) Object.assign(patient, data.patient);

    refreshControlsUI();

    const targetMode =
      data.mode === "VC" || data.mode === "PC" || data.mode === "PS"
        ? data.mode
        : mode;
    switchMode(targetMode); // also refreshes the settings bar, active tab, mode note, and resets breath state for a clean start
  }

  const btnSave = $("btnSaveSettings");
  if (btnSave) {
    btnSave.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(serializeState(), null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "settings.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  const btnLoad = $("btnLoadSettings");
  const loadFileInput = $("loadFileInput");
  if (btnLoad && loadFileInput) {
    btnLoad.addEventListener("click", () => loadFileInput.click());
    loadFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          applyState(JSON.parse(reader.result));
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
  // silently and keeps the hardcoded defaults above if none is found, or if
  // the page was opened directly via file:// where fetch() of local files
  // is often blocked by the browser.
  fetch("settings.json")
    .then((r) =>
      r.ok ? r.json() : Promise.reject(new Error("no settings.json")),
    )
    .then((data) => applyState(data))
    .catch(() => {
      /* no settings.json present -- keep hardcoded defaults */
    });


  
  // ---------------- MINIMAL GLOBAL EXPORT ----------------
  // Everything else in this file is intentionally scoped inside the IIFE.
  // This is the one hook the Unity loader's ready callback needs: a way to
  // hand VentUnityBridge a fresh snapshot at the moment Unity comes online
  // (see VentUnityBridge.setUnityInstance(instance, getStateFn) in
  // unity-bridge.js, and the loader stub at the bottom of index.html).
  // Plain snapshot object handed to the Unity bridge every frame -- the
  // bridge itself decides whether it's worth actually sending (throttle +
  // send-on-change gating live entirely in unity-bridge.js).
  //
  // Sends fully-resolved values (leftLungFrac/bronchLWidth/o2Frac/etc), not
  // raw ingredients (fillFrac, expGain, rFrac) -- Unity applies its own
  // trivial unit conversion (e.g. width -> localScale) but no longer
  // re-derives resistance narrowing or the SpO2/PaCO2 clinical thresholds
  // itself. stiffFrac is the one exception, kept raw since Unity's shader
  // uses it directly as a material property, a legitimately separate need
  // from anything the SVG computes from it.
  function buildUnitySnapshot() {
    return {
      leftLungFrac: leftLungFrac,
      rightLungFrac: rightLungFrac,
      stiffFrac: stiffFrac,
      bronchLWidth: bronchLWidth,
      bronchRWidth: bronchRWidth,
      alvScale: alvScale,
      overDist: overDist,
      phase: phase,
      effort: patient.effort,
      spo2: spo2,
      paCO2: paCO2,
      o2Frac: o2Frac,
      co2Frac: co2Frac,
      shuntFrac: shuntFrac,
      leftCollapsed: patient.leftCollapsed,
      rightCollapsed: patient.rightCollapsed,
    };
  }
  window.getVentUnitySnapshot = buildUnitySnapshot;

  // init
  fitCanvas();
  renderSettingsBar();
  requestAnimationFrame(loop);
})();