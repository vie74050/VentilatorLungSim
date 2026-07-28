import { ReadoutsView } from "./ReadoutsView.js";

// ---------------- LUNG/MODEL VISUAL ----------------
const COLLAPSED_SCALE = 0.78;
// collapsed lung tint (converted from rgb(130,128,124))
const COLLAPSED_COLOR = 1042; // degrees
const COLLAPSED_BRIGHTNESS = 0.7;

// Convert an RGB interpolation into a hue-rotate angle, so tissue color can
// be driven by a single stiffFrac (0-1) value via CSS filter rather than
// needing per-frame fill-color interpolation.
function tissueColor(frac) {
  const lo = [155, 3, 35]; // darker stiffened red
  const hi = [255, 0, 0]; // healthy light pink

  const mix = lo.map((v, i) => Math.round(v + (hi[i] - v) * (1 - frac)));

  // Convert RGB -> hue angle (0-360)
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

  return h * 3; // degrees for hue-rotate()
}

export class LungVisual2D {
  constructor(dom) {
    // dom: { lungL, lungR, lungLimg, lungRimg, bronchL, bronchR,
    //        alvCircles, o2Circles, co2Circles, gasExchangeGroup,
    //        ...ReadoutsView dom fields }
    this.dom = dom;
    this.readouts = new ReadoutsView(dom);
    this.lastSpo2 = null;
    this.lastPaCO2 = null;
  }

  // fractions: object returned by PatientFractions.derive(), merged with
  // deriveGasFractions() (o2Frac/co2Frac). gas: { spo2, paCO2, shuntFrac }.
  update(patient, fractions, gas) {
    const { dom } = this;
    const {
      leftLungFrac,
      rightLungFrac,
      stiffFrac,
      rFrac,
      alvScale,
      overDist,
      o2Frac,
      co2Frac,
    } = fractions;

    /* LUNGS */
    const lungScaleL = 1 + leftLungFrac * 0.22;
    const lungScaleR = 1 + rightLungFrac * 0.22;
    const breathingBrightness = 1.7 - rFrac * 0.5 - stiffFrac * 0.5; // darker as resistance or stiffness rises

    this._apply2DLungSide(
      dom.lungL,
      dom.lungLimg,
      patient.leftCollapsed,
      lungScaleL,
      breathingBrightness,
      stiffFrac,
    );
    this._apply2DLungSide(
      dom.lungR,
      dom.lungRimg,
      patient.rightCollapsed,
      lungScaleR,
      breathingBrightness,
      stiffFrac,
    );

    /* BRONCHI */
    // resistance -> visually narrow / thicken & darken the airway (bronchi).
    const bronchWidth = 6 - rFrac * 3.2; // narrows as resistance climbs
    const OCCLUDED_COLOR = "#5c5852";
    const bronchColor = rFrac > 0.5 ? "#8a5147" : "#c98a78";

    dom.bronchL.setAttribute("stroke-width", bronchWidth.toFixed(1));
    dom.bronchL.style.stroke = patient.leftCollapsed
      ? OCCLUDED_COLOR
      : bronchColor;
    dom.bronchR.setAttribute("stroke-width", bronchWidth.toFixed(1));
    dom.bronchR.style.stroke = patient.rightCollapsed
      ? OCCLUDED_COLOR
      : bronchColor;

    /* ALVEOLI */
    // shuntFrac determines how many alveoli are "open" (pink) vs "closed"
    // (grey) -- visual cue for how much of the lung is effectively
    // participating in gas exchange.
    const alvCircles = dom.alvCircles;
    const o2Circles = dom.o2Circles;
    const co2Circles = dom.co2Circles;
    const openAlvCount = Math.round((1 - gas.shuntFrac) * alvCircles.length);

    alvCircles.forEach((c, i) => {
      if (i < openAlvCount) {
        c.style.transform = `scale(${alvScale.toFixed(4)})`;
        // Paw overdistension cue: alveoli flush warning-amber if pressure
        // climbs high while near full inflation
        c.style.fill = overDist ? "#e0a23d" : "#e8978a";
        o2Circles[i].classList.remove("collapsed");
        co2Circles[i].classList.remove("collapsed");
      } else {
        c.style.transform = `scale(${COLLAPSED_SCALE})`;
        c.style.fill = `hsl(${COLLAPSED_COLOR}, 20%, 50%)`;
        o2Circles[i].classList.add("collapsed");
        co2Circles[i].classList.add("collapsed");
      }
    });

    // O2/CO2 exchange dot intensity -- spo2/paCO2 only change once per
    // breath (GasExchangeModel.update(), at the insp->exp transition), so
    // gate the DOM write the same way the C/R readouts are gated.
    if (
      dom.gasExchangeGroup &&
      (gas.spo2 !== this.lastSpo2 || gas.paCO2 !== this.lastPaCO2)
    ) {
      dom.gasExchangeGroup.style.setProperty("--o2-intensity", o2Frac.toFixed(2));
      dom.gasExchangeGroup.style.setProperty("--co2-intensity", co2Frac.toFixed(2));

      // O2/CO2 exchange dot anim duration. This is purely visual, not physiologic.
      const DUR_MAX = 5,
        DUR_MIN = 1.0;
      const o2Dur = DUR_MAX - (DUR_MAX - DUR_MIN) * o2Frac;
      const co2Dur = DUR_MAX - (DUR_MAX - DUR_MIN) * co2Frac;
      dom.gasExchangeGroup.style.setProperty("--o2-duration", o2Dur.toFixed(2) + "s");
      dom.gasExchangeGroup.style.setProperty("--co2-duration", co2Dur.toFixed(2) + "s");
    }

    this.readouts.updateLungPanelReadouts(patient, gas.spo2, gas.paCO2);
    this.lastSpo2 = gas.spo2;
    this.lastPaCO2 = gas.paCO2;
  }

  _apply2DLungSide(lungEl, imgEl, collapsed, normalScale, normalBrightness, stiffFrac) {
    if (collapsed) {
      lungEl.style.transform = `scale(${COLLAPSED_SCALE})`;
      imgEl.style.filter = `hue-rotate(${COLLAPSED_COLOR}deg) brightness(${COLLAPSED_BRIGHTNESS})`;
    } else {
      lungEl.style.transform = `scale(${normalScale.toFixed(4)})`;
      imgEl.style.filter = `hue-rotate(${tissueColor(stiffFrac)}deg) brightness(${normalBrightness.toFixed(3)})`;
    }
  }
}
