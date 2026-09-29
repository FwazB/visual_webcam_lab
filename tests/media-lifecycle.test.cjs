/* eslint-disable @typescript-eslint/no-require-imports -- Executes production media effects with Node's CommonJS test bootstrap. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const flush = () => new Promise(setImmediate);

function mediaStream() {
  let stopped = 0;
  return { getTracks: () => [{ stop: () => { stopped++; } }], stopped: () => stopped };
}

// Extract the real camera effect so the test exercises its asynchronous
// lifetime without starting unrelated rendering/ML hooks or a real camera.
function cameraEffect(name) {
  const source = fs.readFileSync(require.resolve(`../src/components/${name}.tsx`), "utf8");
  const tree = ts.createSourceFile(`${name}.tsx`, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  let effect;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect" && node.arguments[0]?.getText(tree).includes("getUserMedia")) {
      effect = node.arguments[0].getText(tree);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(effect, "camera effect exists");
  let finish;
  const video = { srcObject: null };
  const context = {
    module: { exports: {} },
    window: { innerWidth: 1280 },
    navigator: { mediaDevices: { getUserMedia: () => new Promise((resolve) => { finish = resolve; }) } },
    videoRef: { current: video },
    setWebcamReady() {},
    setCameraError() {},
    console,
  };
  vm.runInNewContext(compile(`module.exports = ${effect}`), context);
  const cleanup = context.module.exports();
  return { finish: (stream) => finish(stream), cleanup, video };
}

for (const name of ["AsciiCamera", "FretLab"]) {
  test(`${name} releases a camera granted after navigation`, async () => {
    const run = cameraEffect(name);
    const stream = mediaStream();
    run.cleanup();
    run.finish(stream);
    await flush();
    assert.equal(stream.stopped(), 1);
    assert.equal(run.video.srcObject, null);
  });

  test(`${name} releases an active camera on normal unmount`, async () => {
    const run = cameraEffect(name);
    const stream = mediaStream();
    run.finish(stream);
    await flush();
    assert.equal(run.video.srcObject, stream);
    run.cleanup();
    assert.equal(stream.stopped(), 1);
  });
}
