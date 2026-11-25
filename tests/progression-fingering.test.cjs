/* eslint-disable @typescript-eslint/no-require-imports -- Render the chord shape with Node's test runner. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { getSongChord } = require("../src/lib/progressions/music");

const fileName = require.resolve("../src/components/ProgressionFingering.tsx");
const { outputText } = ts.transpileModule(fs.readFileSync(fileName, "utf8"), {
  fileName, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const loaded = { exports: {} };
new Function("require", "module", "exports", outputText)(
  name => name.endsWith(".module.css") ? { default: {} } : require(name), loaded, loaded.exports,
);

function renderShape(step, instrument, level) {
  const chord = getSongChord(step, instrument, level);
  return renderToStaticMarkup(React.createElement(loaded.exports.default, {
    chord, instrument, level, position: "Bar 1", hear() {},
  }));
}

function positionRows(markup) {
  const table = markup.match(/<table\b[^>]*>([\s\S]*?)<\/table>/);
  assert.ok(table, "The chord shows a fret table");
  assert.doesNotMatch(markup.slice(0, table.index), /<details\b/);
  return [...table[1].matchAll(/<tr>(.*?)<\/tr>/g)].map(row =>
    [...row[1].matchAll(/<(?:th|td)\b[^>]*>([^<]+)</g)].map(cell => cell[1]));
}

test("guitar displays the fret and finger for every string, including muted and open strings", () => {
  const markup = renderShape({ name: "C", root: 0, quality: "major", numeral: "I" }, "guitar", "easy");
  assert.deepEqual(positionRows(markup), [
    ["String", "low E", "A", "D", "G", "B", "high E"],
    ["Fret", "Mute", "3", "2", "Open", "1", "Open"],
    ["Finger", "—", "3", "2", "—", "1", "—"],
  ]);
});

test("a shifted bass shape displays actual frets in the table and on the diagram", () => {
  const markup = renderShape({ name: "Em", root: 4, quality: "minor", numeral: "i" }, "bass", "advanced");
  assert.deepEqual(positionRows(markup), [
    ["String", "E", "A", "D", "G"],
    ["Fret", "12", "14", "Mute", "12"],
    ["Finger", "1", "4", "—", "2"],
  ]);
  const diagram = markup.match(/<svg\b[\s\S]*?<\/svg>/)[0];
  assert.match(diagram, />Fret<\/text>/);
  for (const fret of [12, 13, 14, 15]) assert.ok(diagram.includes(`>${fret}</text>`));
});
