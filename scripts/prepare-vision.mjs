import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Serve the lockfile-pinned WASM runtime locally; camera pixels stay in-browser.
const require = createRequire(import.meta.url);
const runtime = require.resolve("@techstark/opencv-js");
const packageRoot = path.resolve(path.dirname(runtime), "..");
const metadata = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
if (metadata.version !== "4.12.0-release.1") throw new Error("Update the pinned vision asset path when updating OpenCV.");
const destination = fileURLToPath(new URL("../public/vision/", import.meta.url));
await mkdir(destination, { recursive: true });
await copyFile(runtime, path.join(destination, "opencv-4.12.0.js"));
await copyFile(path.join(packageRoot, "LICENSE"), path.join(destination, "OPENCV-LICENSE"));
