#!/usr/bin/env node
// ---------------- BUILD D2L INDEX ----------------
// This script
// 1. writes index.html to dist/{version}/index.html, and
// 2. re-writes relative paths to absolute paths in HTML for D2L in dist/{version}/index.html, and
// 3. builds scripts/ into dist/{version}/scripts:
//      - vent-scripts.js (+ everything under scripts/src/, 26 files) is
//        bundled and minified into ONE file -- 26 module fetches -> 1
//      - styles.css is minified
//      - scripts/assets/** (and anything else not .js/.css) is copied
//        through as-is
//    scripts/src/ itself is NOT copied into dist/ -- it's fully inlined
//    into the vent-scripts.js bundle
//
// Copy only index.html (+ settings.json) to D2L course; everything
// else living on GitHub Pages. 
//
// Usage:
//   node tools/build-d2l-index.js
//   node tools/build-d2l-index.js -- --v {version}   (e.g. --v v1.0.0)
//   node tools/build-d2l-index.js -- --v v1.0.0 --no-minify   (readable/debuggable build)

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, extname, relative, resolve } from "node:path";
import * as esbuild from "esbuild";

const DEFAULT_BASE = "https://vie74050.github.io/VentilatorLungSim/dist/";
const SRC = "index.html";
const SCRIPTS_SRC = "scripts";
const ENTRY = join(SCRIPTS_SRC, "vent-scripts.js");
 
function parseArgs(argv) {
  const vIdx = argv.indexOf("--v");
  const version = vIdx !== -1 ? argv[vIdx + 1] : "v1.0.0";
  const base = `${DEFAULT_BASE}${version}`;
  const minify = !argv.includes("--no-minify");

  return {
    base: base.endsWith("/") ? base : `${base}/`,
    minify,
  };
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// The whole ES module app -> one bundled + minified file. This is the one
// piece that actually needs `bundle: true` -- it's the only file with an
// internal import graph (scripts/src/**, 25 files deep).
async function buildAppBundle(scriptsDistFolder, minify) {
  await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    minify,
    format: "esm",
    target: "es2020",
    outfile: join(scriptsDistFolder, "vent-scripts.js"),
    sourcemap: minify ? "external" : false,
  });
}

// js outside src just minifies whitespace/identifiers in place and leaves
// every top-level declaration and the global scope exactly as written.
async function buildStandaloneScript(file, outPath, minify) {
  const source = readFileSync(file, "utf8");
  const result = await esbuild.transform(source, {
    minify,
    loader: "js",
    sourcefile: relative(SCRIPTS_SRC, file),
  });
  writeFileSync(outPath, result.code, "utf8");
}

async function buildStylesheet(file, outPath, minify) {
  const source = readFileSync(file, "utf8");
  const result = await esbuild.transform(source, { loader: "css", minify });
  writeFileSync(outPath, result.code, "utf8");
}

// Builds scripts/ into scriptsDistFolder: bundles the app, minifies the
// standalone scripts + stylesheet, copies everything else (assets/, etc.)
// through untouched.
async function buildScriptsFolder(scriptsDistFolder, minify) {
  rmSync(scriptsDistFolder, { recursive: true, force: true });
  mkdirSync(scriptsDistFolder, { recursive: true });

  await buildAppBundle(scriptsDistFolder, minify);

  let scriptCount = 1; // the app bundle, already built above
  let cssCount = 0;
  let copiedCount = 0;

  const topLevelFiles = readdirSync(SCRIPTS_SRC)
    .map((f) => join(SCRIPTS_SRC, f))
    .filter((f) => statSync(f).isFile() && resolve(f) !== resolve(ENTRY)); 
  for (const file of topLevelFiles) {
    const rel = relative(SCRIPTS_SRC, file);
    const outPath = join(scriptsDistFolder, rel);
    if (extname(file) === ".js") {
      await buildStandaloneScript(file, outPath, minify);
      scriptCount++;
    } else if (extname(file) === ".css") {
      await buildStylesheet(file, outPath, minify);
      cssCount++;
    } else {
      copyFileSync(file, outPath);
      copiedCount++;
    }
  }

  // Copy every other subfolder under scripts/ (assets/, etc.) through
  // as-is -- src/ is excluded since it's already fully inlined above.
  const topLevelDirs = readdirSync(SCRIPTS_SRC).filter(
    (f) => statSync(join(SCRIPTS_SRC, f)).isDirectory() && f !== "src",
  );
  for (const dirName of topLevelDirs) {
    const srcDir = join(SCRIPTS_SRC, dirName);
    for (const file of walk(srcDir)) {
      const rel = relative(SCRIPTS_SRC, file);
      const outPath = join(scriptsDistFolder, rel);
      mkdirSync(dirname(outPath), { recursive: true });
      copyFileSync(file, outPath);
      copiedCount++;
    }
  }

  return { scriptCount, cssCount, copiedCount };
}

async function main() {
  const { base, minify } = parseArgs(process.argv.slice(2));
  const html = readFileSync(SRC, "utf8");

  console.log(`Creating or updating ${base} folder`);

  // make the base folder if it doesn't exist
  const relBaseFolder = base.replace(DEFAULT_BASE, "");

  // make/or replace the relBase folder within /dist folder
  const distFolder = "dist";
  const baseFolder = join(distFolder, relBaseFolder);
  mkdirSync(baseFolder, { recursive: true });

  // Copy html to distFolder and rewrite href/src to point absolute basepaths
  // Only rewrites href="scripts/... and src="scripts/... -- leaves other href/src alone
  const rewrittenHtml = html.replace(/(href|src)="scripts\//g, `$1="${base}scripts/`);
  const distIndexPath = join(baseFolder, "index.html");
  writeFileSync(distIndexPath, rewrittenHtml, "utf8");
  console.log(`Wrote ${distIndexPath}`);

  // build (bundle + minify) the scripts folder into distFolder
  const scriptsDistFolder = join(baseFolder, "scripts");
  const { scriptCount, cssCount, copiedCount } = await buildScriptsFolder(
    scriptsDistFolder,
    minify,
  );

  console.log(
    `Wrote ${scriptsDistFolder} -- vent-scripts.js bundled${minify ? " + minified" : ""}, ` +
      `${scriptCount - 1} other script(s) minified, ${cssCount} stylesheet(s) minified, ${copiedCount} asset(s) copied as-is`,
  );
}

main();
