# Natural room audio system 4.3.2

The release uses an original procedural 48 kHz stereo sound pack. No external recordings or samples are bundled.

## Design rules

- ordinary buttons, tabs, sheets, switches and sliders are completely silent;
- sound is emitted only by a physical event in the game world;
- no jump-scare hits or bright reward jingles;
- mechanical sounds have headroom and softened high frequencies;
- distant events lose high frequencies and gain room reflections;
- rare sounds use long, irregular pauses instead of constant noise;
- important actions briefly lower ambience by only a small amount;
- the default effects level is deliberately conservative for phone speakers.

## Mix architecture

- separate ambience and world-action buses;
- gentle compressor with a slow attack and release;
- per-event low-pass filtering based on softness and distance;
- convolution reverb using original corridor and room impulse responses;
- spatial panning that can be disabled;
- per-cue cooldowns and strict polyphony limits;
- adaptive low/high tension beds without sudden stingers;
- scene crossfades and random loop offsets;
- AAC/M4A assets for Telegram Android and iOS WebViews.

## Audible events

The player hears the elevator motor, relays, brakes, doors, locks, keys, paper, objects, footsteps, pipes, water, walls, intercom, room movement and radio hardware. Interface navigation remains silent.

## Regeneration

```bash
python3 scripts/generate-audio.py
```

The generator uses NumPy/SciPy acoustic modelling and FFmpeg encoding.
