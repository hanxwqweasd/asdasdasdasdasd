# Cinematic audio system 4.1.0

The release contains an original procedural 48 kHz stereo sound pack. No external samples are used.

## Mix architecture

- independent ambience, world-action and interface buses;
- dynamics compression and automatic ambience ducking;
- convolution reverb using original corridor and room impulse responses;
- spatial panning that can be disabled;
- per-cue cooldowns, polyphony limits and subtle pitch variation;
- adaptive low/high tension layers for expeditions;
- scene crossfades and random loop offsets;
- AAC/M4A assets for Telegram Android and iOS WebViews.

## Coverage

Sounds are attached to navigation, buttons, sheets, switches, sliders, messages, voting, inventory, item placement, clues, stat changes, purchases, radio ritual, solo expeditions, spectator actions, reconnection and cooperative matches. Rare environmental events are scheduled separately and can be disabled.

## Regeneration

```bash
python3 scripts/generate-audio.py
```

The generator uses only NumPy/SciPy synthesis and FFmpeg encoding.
