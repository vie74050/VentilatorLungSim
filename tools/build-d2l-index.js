#!/usr/bin/env node
// ---------------- BUILD D2L INDEX ----------------
// This script produces HTML version for d2L in dist/index.html;
// the repo's index.html is never modified. 
//
// D2L only gets index.html (+ settings.json) per course, with everything
// else living on GitHub Pages. 
//
// Usage:
//   node tools/build-d2l-index.js
//   node tools/build-d2l-index.js --base https://vie74050.github.io/VentilatorLungSim/scripts/
//   node tools/build-d2l-index.js --base https://cdn.jsdelivr.net/gh/vie74050/VentilatorLungSim@v1.0.0/scripts/
//
// NB: Use jsDelivr version-lock once deployed to real courses
// rather than just testing to pin to a tagged release instead of the
// live (mutable) main branch, so pushing a WIP commit can't break every
// course using this simulator at once.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_BASE = "https://vie74050.github.io/VentilatorLungSim/scripts/";
const SRC = "index.html";
const OUT = "dist/index.html";

function parseBase(argv) {
  const i = argv.indexOf("--base");
  const base = i !== -1 ? argv[i + 1] : DEFAULT_BASE;
  if (!base) {
    throw new Error("--base was given but had no value");
  }
  return base.endsWith("/") ? base : `${base}/`;
}

function main() {
  const base = parseBase(process.argv.slice(2));
  const html = readFileSync(SRC, "utf8");

  // Only rewrites href="scripts/... and src="scripts/... -- leaves
  // settings.json (must stay relative, resolves against the D2L page)
  // and the external BCIT favicon untouched.
  const pattern = /((?:href|src)=")scripts\//g;
  const matches = html.match(pattern) || [];
  if (matches.length === 0) {
    console.warn(
      "Warning: no href/src=\"scripts/...\" references found -- check that index.html still uses relative paths, or that this script still matches its structure.",
    );
  }
  const rewritten = html.replace(pattern, `$1${base}`);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, rewritten, "utf8");
  console.log(`Wrote ${OUT} -- rewrote ${matches.length} reference(s) to ${base}`);
  console.log("Upload dist/index.html (+ this course's settings.json) to D2L. Do not upload the scripts/ folder.");
}

main();
