/* eslint-disable @typescript-eslint/no-require-imports -- Render the client controls with Node's test runner. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const React = require("react");
const jsx = require("react/jsx-runtime");
const { renderToStaticMarkup } = require("react-dom/server");

const fileName = require.resolve("../src/components/ProgressionGenerator.tsx");
const { outputText } = ts.transpileModule(fs.readFileSync(fileName, "utf8"), {
  fileName, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});

test("chord selection, metronome and live tempo use their own player controls", t => {
  const player = { starting: true, playing: false, metronome: false, preview: t.mock.fn(), play: t.mock.fn(),
    toggleMetronome: t.mock.fn(), setTempo: t.mock.fn(), stopLoop: t.mock.fn() };
  const tiles = [];
  let tilt, metronome, tempo;
  const capture = render => (type, props, key) => {
    if (type === "button" && props["aria-label"]?.startsWith("Chord ")) tiles.push(props);
    if (type === "input" && props.type === "checkbox") metronome = props;
    if (type === "input" && props["aria-label"] === "Tempo") tempo = props;
    return render(type, props, key);
  };
  const overrides = {
    "react/jsx-runtime": { ...jsx, jsx: capture(jsx.jsx), jsxs: capture(jsx.jsxs) },
    "@/hooks/useProgressionPlayer": { useProgressionPlayer: () => player },
    "@/hooks/useTiltStep": { useTiltStep: fn => { tilt = fn; } },
    "./ProgressionsInstall": { default: () => null },
    "./CustomProgressionEditor": { default: () => null },
    "./ProgressionFingering": { default: () => null },
    "./SpotifyChordLookup": { default: () => null },
    "./ProgressionGenerator.module.css": { default: {} },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    name => overrides[name] ?? require(name), loaded, loaded.exports,
  );
  const html = renderToStaticMarkup(React.createElement(loaded.exports.default, { initialInstrument: "bass" }));
  assert.match(html, /<p role="status"[^>]*>Starting audio…<\/p>/);
  assert.equal(metronome.checked, false);
  metronome.onChange();
  assert.deepEqual(player.toggleMetronome.mock.calls[0].arguments, [60]);
  assert.equal(player.play.mock.callCount(), 0);
  tempo.onChange({ target: { value: "105" } });
  assert.deepEqual(player.setTempo.mock.calls[0].arguments, [105]);
  assert.equal(player.stopLoop.mock.callCount(), 0);
  assert.equal(tiles.length, 3);
  const selected = tiles[1]; // D on the open D string in the first guided bass exercise.
  selected.onClick();
  assert.deepEqual(player.preview.mock.calls[0].arguments, [[38], "bass"]);
  assert.equal(player.play.mock.callCount(), 0);
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
    selected.onKeyDown({ key, preventDefault() {} });
  }
  tilt(1);
  assert.equal(player.preview.mock.callCount(), 1);
  assert.equal(player.play.mock.callCount(), 0);
  player.playing = true;
  selected.onClick();
  assert.deepEqual(player.play.mock.calls[0].arguments, [[[33], [38], [33]], "bass", 60, 1, [8, 4, 4]]);
  assert.equal(player.preview.mock.callCount(), 1);
});
