import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function text(file: string): Promise<string> {
  return readFile(path.join(root, file), "utf8");
}

test("final client shell exposes app identity and Telegram-safe assets", async () => {
  const [html, manifest, app, icons] = await Promise.all([
    text("public/index.html"),
    text("public/manifest.webmanifest"),
    text("public/app.js"),
    text("public/assets/icons.svg"),
  ]);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /id="bootScene"/);
  assert.match(html, /floorTransition/);
  assert.match(app, /const APP_VERSION = "4\.1\.0"/);
  assert.match(app, /class HouseAudioEngine/);
  assert.match(manifest, /Восьмого этажа нет/);
  assert.match(icons, /symbol id="elevator"/);
});

test("cinematic audio pack contains high-quality spatial layers and tactile cues", async () => {
  const required = [
    "public/audio/elevator-travel.m4a",
    "public/audio/door-open.m4a",
    "public/audio/eighth-floor.m4a",
    "public/audio/apartment-night.m4a",
    "public/audio/footsteps-01.m4a",
    "public/audio/whisper-01.m4a",
    "public/audio/ui-tap-01.m4a",
    "public/audio/purchase-stars.m4a",
    "public/audio/corridor-ir.wav",
    "public/audio/manifest.json",
  ];
  for (const file of required) {
    const info = await stat(path.join(root, file));
    assert.ok(info.size > (file.includes("ui-tap") ? 1_200 : 4_000), `${file} is unexpectedly small`);
  }
  const [manifest, app]=await Promise.all([
    text("public/audio/manifest.json").then(JSON.parse),
    text("public/app.js"),
  ]);
  assert.equal(manifest.version,"4.1.0");
  assert.equal(manifest.sampleRate,48_000);
  assert.ok(manifest.assets.length >= 90);
  assert.match(app, /const SOUND_CUES/);
  assert.match(app, /reverbReturn/);
  assert.match(app, /setTension/);
});

test("every declared cue and adaptive scene layer has a packaged audio asset", async () => {
  const app = await text("public/app.js");
  const cueBlock = app.slice(app.indexOf("const SOUND_CUES"), app.indexOf("const LEGACY_SOUND_CUES"));
  const names = new Set<string>();
  for (const match of cueBlock.matchAll(/assets:\s*\[([^\]]+)\]/g)) {
    for (const quoted of match[1].matchAll(/"([^"]+)"/g)) names.add(quoted[1]);
  }
  for (const name of [
    "apartment-night", "rain-window", "lamp-hum", "coop-tension",
    "eighth-floor", "building-hall", "neighbor", "archive-room",
    "market-lobby", "wind", "tension-low", "tension-high",
  ]) names.add(name);
  assert.ok(names.size >= 75);
  for (const name of names) {
    const info = await stat(path.join(root, `public/audio/${name}.m4a`));
    assert.ok(info.size > 1_000, `missing or empty audio cue: ${name}`);
  }
  assert.match(app, /document\.addEventListener\("pointerdown"/);
  assert.match(app, /input\[type='range'\]/);
  assert.match(app, /interactionCueFor/);
  assert.match(app, /setTension\(state\.expedition\.state\.danger\)/);
});
