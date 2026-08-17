#!/usr/bin/env node
// ---------------- BUILD D2L INDEX ----------------
// This script produces HTML version for d2L in dist/{{version}}/index.html, with all href/src rewritten to absolute paths.
//
// D2L only gets index.html (+ settings.json) per course, with everything
// else living on GitHub Pages. 
//
// Usage:
//   node tools/build-d2l-index.js
//   node tools/build-d2l-index.js -- --v {version}  (e.g. --v v1.0.0)

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync
} from "node:fs";
import { dirname } from "node:path";

const DEFAULT_BASE = "https://vie74050.github.io/VentilatorLungSim/dist/";
const SRC = "index.html"; 
const SCRIPTS_SRC = "scripts";

function parseBase(argv) {
  const i = argv.indexOf("--v");
  const version = i !== -1 ? argv[i + 1] : "v1.0.0";
  const base = `${DEFAULT_BASE}${version}`;

  return base.endsWith("/") ? base : `${base}/`;

}

function main() {
  const base = parseBase(process.argv.slice(2));
  const html = readFileSync(SRC, "utf8");

  console.log(`Created or updated ${base} folder`);

  // make the base folder if it doesn't exist
  const relbaseFolder = base.replace(DEFAULT_BASE, "");

  // make/or replace the relbase folder within /dist folder
  const distFolder = "dist";
  const baseFolder = `${distFolder}/${relbaseFolder}`;
  mkdirSync(baseFolder, { recursive: true });

  // Copy html to distFolder and rewrite href/src to point absolute basepaths
  // Only rewrites href="scripts/... and src="scripts/... -- leaves other href/src alone
  
  const rewrittenHtml = html.replace(/(href|src)="scripts\//g, `$1="${base}scripts/`);
  const distIndexPath = `${baseFolder}/index.html`;
  writeFileSync(distIndexPath, rewrittenHtml, "utf8");
  console.log(`Wrote ${distIndexPath}`);

  // copy the scripts folder and copy to distFolder
  const scriptsSrcFolder = SCRIPTS_SRC;
  const scriptsDistFolder = `${baseFolder}/scripts`;

  mkdirSync(scriptsDistFolder, { recursive: true });

  cpSync(scriptsSrcFolder, scriptsDistFolder, {
    recursive: true,
  });
}

main();
