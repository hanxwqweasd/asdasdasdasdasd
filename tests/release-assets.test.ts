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
  assert.match(app, /const APP_VERSION = "4\.0\.0"/);
  assert.match(app, /class HouseAudioEngine/);
  assert.match(manifest, /Восьмого этажа нет/);
  assert.match(icons, /symbol id="elevator"/);
});

test("atmospheric audio pack contains substantial original layers", async () => {
  const required = [
    "public/audio/elevator.wav",
    "public/audio/door.wav",
    "public/audio/floor-ambience.ogg",
    "public/audio/rain-window.ogg",
    "public/audio/footsteps.ogg",
    "public/audio/whisper.ogg",
    "public/audio/intercom.ogg",
  ];
  for (const file of required) {
    const info = await stat(path.join(root, file));
    assert.ok(info.size > 5_000, `${file} is unexpectedly small`);
  }
});
