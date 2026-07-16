#!/usr/bin/env python3
"""Generate the Eighth Floor naturalistic audio pack.

All assets are original procedural acoustic models. No external recordings or samples.
Output: 48 kHz stereo AAC/M4A with restrained peaks and natural room distance.
"""
from __future__ import annotations

import math
import shutil
from functools import lru_cache
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, chirp, fftconvolve, sosfilt

SR = 48_000
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "audio"
TMP = ROOT / ".audio-build"
R = np.random.default_rng(808_430)

OUT.mkdir(parents=True, exist_ok=True)
TMP.mkdir(parents=True, exist_ok=True)


def nframes(duration: float) -> int:
    return max(1, int(round(SR * duration)))


def time(duration: float) -> np.ndarray:
    return np.arange(nframes(duration), dtype=np.float64) / SR


def envelope(length: int, attack: float = 0.005, release: float = 0.08, curve: float = 1.5) -> np.ndarray:
    e = np.ones(length, dtype=np.float64)
    a = min(length, max(1, int(SR * attack)))
    r = min(length, max(1, int(SR * release)))
    e[:a] = np.linspace(0, 1, a, endpoint=False) ** curve
    e[-r:] = np.linspace(1, 0, r) ** curve
    return e


def adsr(length: int, attack=.01, decay=.08, sustain=.7, release=.15) -> np.ndarray:
    a = min(length, max(1, int(SR * attack)))
    d = min(max(0, length-a), max(1, int(SR * decay)))
    r = min(max(1, length-a-d), max(1, int(SR * release)))
    s = max(0, length-a-d-r)
    return np.concatenate([
        np.linspace(0, 1, a, endpoint=False),
        np.linspace(1, sustain, d, endpoint=False),
        np.full(s, sustain),
        np.linspace(sustain, 0, r),
    ])[:length]


def noise(duration: float, colour: str = "white") -> np.ndarray:
    x = R.normal(0, 1, nframes(duration)).astype(np.float64)
    if colour == "pink":
        # Fast frequency-domain 1/f shaping.
        spectrum=np.fft.rfft(x)
        frequencies=np.fft.rfftfreq(len(x),1/SR)
        scale=np.ones_like(frequencies)
        scale[1:]=1/np.sqrt(frequencies[1:])
        spectrum*=scale
        x=np.fft.irfft(spectrum,n=len(x))
        x-=np.mean(x); x/=max(np.std(x),1e-9)
    elif colour == "brown":
        x=np.cumsum(x); x-=np.mean(x); x/=max(np.std(x),1e-9)
    return x


@lru_cache(maxsize=64)
def filter_sos(kind: str, cutoff_key: tuple[float, ...], order: int):
    ny=SR/2
    wn=[c/ny for c in cutoff_key] if len(cutoff_key)>1 else cutoff_key[0]/ny
    return butter(order,wn,btype=kind,output="sos")

def filt(x: np.ndarray, kind: str, cutoff, order: int = 4) -> np.ndarray:
    key=tuple(float(c) for c in cutoff) if isinstance(cutoff,tuple) else (float(cutoff),)
    return sosfilt(filter_sos(kind,key,order), x, axis=0 if np.asarray(x).ndim > 1 else -1)


def oscillator(freq, duration: float, waveform: str = "sine", phase: float = 0) -> np.ndarray:
    t = time(duration)
    f = np.asarray(freq) if not np.isscalar(freq) else float(freq)
    if np.isscalar(f):
        p = 2 * np.pi * f * t + phase
    else:
        f = np.resize(f, len(t)); p = 2*np.pi*np.cumsum(f)/SR + phase
    if waveform == "sine": return np.sin(p)
    if waveform == "triangle": return 2/np.pi*np.arcsin(np.sin(p))
    if waveform == "square": return np.sign(np.sin(p))
    if waveform == "saw": return 2*((p/(2*np.pi))%1)-1
    raise ValueError(waveform)


def pan_mono(x: np.ndarray, pan: float = 0.0, width: float = 0.0) -> np.ndarray:
    pan = float(np.clip(pan, -1, 1))
    angle = (pan + 1) * np.pi / 4
    left = x * np.cos(angle); right = x * np.sin(angle)
    if width:
        delay = max(1, int(SR * 0.011))
        right = right*(1-width) + np.roll(left, delay)*width
        right[:delay] *= 0.45
    return np.column_stack([left, right])


def stereo_noise(duration: float, colour="white", correlation=.25) -> np.ndarray:
    a=noise(duration,colour); b=noise(duration,colour)
    return np.column_stack([a, correlation*a+(1-correlation)*b])


def place(buf: np.ndarray, start: float, clip: np.ndarray, gain: float = 1.0, pan: float | None = None) -> None:
    if clip.ndim == 1:
        clip = pan_mono(clip, 0 if pan is None else pan)
    i=max(0,int(start*SR)); j=min(len(buf),i+len(clip))
    if j>i: buf[i:j] += clip[:j-i]*gain


def softclip(x: np.ndarray, drive: float = 1.25) -> np.ndarray:
    return np.tanh(x*drive)/np.tanh(drive)


def master(x: np.ndarray, peak: float = 0.90, dc=True) -> np.ndarray:
    x=np.asarray(x,dtype=np.float64)
    if x.ndim==1: x=pan_mono(x)
    if dc: x=x-np.mean(x,axis=0,keepdims=True)
    x=softclip(x)
    m=float(np.max(np.abs(x))) or 1.0
    return (x/m*peak).astype(np.float32)


def seamless(x: np.ndarray, seconds: float = 1.4) -> np.ndarray:
    x=np.asarray(x,dtype=np.float64)
    f=min(len(x)//3,max(1,int(seconds*SR)))
    w=np.linspace(0,1,f)[:,None]
    blend=x[:f]*(1-w)+x[-f:]*w
    x[:f]=blend; x[-f:]=blend
    return x


def room_ir(duration=1.65, decay=3.7, pre_delay=.021, width=.9) -> np.ndarray:
    n=nframes(duration); t=np.arange(n)/SR
    left=R.normal(0,1,n)*np.exp(-t*decay)
    right=R.normal(0,1,n)*np.exp(-t*(decay*.94))
    left=filt(left,"bandpass",(170,8500)); right=filt(right,"bandpass",(180,8100))
    pred=int(pre_delay*SR); left[:pred]=0; right[:pred]=0
    for delay,g in [(0.033,.44),(0.061,.31),(0.097,.22),(0.151,.14),(0.238,.09)]:
        i=int(delay*SR)
        if i<n:
            left[i]+=g; right[min(n-1,i+int(.006*SR))]+=g*.88
    ir=np.column_stack([left,right])
    return master(ir,peak=.72)


CORRIDOR_IR=room_ir(2.15,2.75,.028)
ROOM_IR=room_ir(1.15,5.0,.011)


def add_reverb(x: np.ndarray, ir: np.ndarray, wet=.16) -> np.ndarray:
    if x.ndim==1: x=pan_mono(x)
    y=np.zeros((len(x)+len(ir)-1,2),dtype=np.float64)
    for c in range(2): y[:,c]=fftconvolve(x[:,c],ir[:,c],mode="full")
    y=y[:len(x)]
    return x*(1-wet)+y*wet


def write_asset(name: str, x: np.ndarray, kind: str = "effect", ogg_q: int = 6, aac_rate: str | None = None) -> None:
    print("encoding", name, flush=True)
    # Naturalistic release: no near-0 dB transients. Headroom prevents phone speakers
    # and Telegram volume normalization from turning mechanical sounds into clicks.
    x=np.asarray(x,dtype=np.float64)
    x=filt(x,"highpass",28,2)
    x=filt(x,"lowpass",11800 if kind=="effect" else 9800,3)
    x=master(x,peak=.39 if kind=="effect" else .42)
    wav=TMP/f"{name}.wav"
    sf.write(wav,x,SR,subtype="PCM_24")
    if aac_rate is None: aac_rate="160k" if kind=="effect" else "128k"
    subprocess.run(["ffmpeg","-y","-loglevel","error","-i",str(wav),"-c:a","aac","-b:a",aac_rate,"-movflags","+faststart",str(OUT/f"{name}.m4a")],check=True)


def write_ir(name: str, ir: np.ndarray) -> None:
    sf.write(OUT/f"{name}.wav",ir,SR,subtype="PCM_24")


def click(freq=900,duration=.09,body=.14,pan=0):
    """Muted mechanical contact, intentionally without a sharp digital transient."""
    duration=max(.07,float(duration)*1.25)
    n=nframes(duration)
    e=envelope(n,.004,duration*.68,1.2)
    contact=filt(noise(duration),"bandpass",(180,2600),3)*e*.12
    resonance=max(220,min(980,float(freq)*.42))
    bodytone=(oscillator(resonance,duration)*.055+oscillator(resonance*.51,duration,"triangle")*.025)*e
    return add_reverb(pan_mono(contact+bodytone,pan,width=.05),ROOM_IR,.045)


def thump(duration=.32,freq=72,pan=0):
    t=time(duration); sweep=freq*(1-.45*np.clip(t/duration,0,1))
    x=oscillator(sweep,duration)*envelope(len(t),.002,duration*.83,1.3)
    x+=filt(noise(duration),"lowpass",260)*envelope(len(t),.001,duration*.6)*.35
    return pan_mono(x,pan,width=.04)


def bell(base=560,duration=2.1,pan=0):
    """Old elevator chime heard through a metal grille, not a bright game bell."""
    base=min(float(base),620)
    x=np.zeros(nframes(duration)); t=time(duration)
    for mult,amp,dec in [(1,.22,2.4),(1.51,.07,3.1),(2.03,.035,4.2)]:
        x+=oscillator(base*mult,duration)*np.exp(-t*dec)*amp
    x+=filt(noise(duration),"bandpass",(180,2100),3)*np.exp(-t*4.4)*.025
    x*=envelope(len(x),.012,.22)
    return add_reverb(pan_mono(x,pan,width=.12),CORRIDOR_IR,.24)


def door(opening=True):
    d=2.15 if opening else 1.55; out=np.zeros((nframes(d),2))
    place(out,0,click(1850,.09,pan=-.12),.8)
    scrape=filt(noise(.9),"bandpass",(160,2100))*envelope(nframes(.9),.03,.24)*.42
    scrape+=oscillator(np.linspace(170,260,nframes(.9)),.9,"triangle")*envelope(nframes(.9),.08,.24)*.13
    place(out,.13,scrape,.9,pan=.05)
    if opening:
        place(out,.78,thump(.42,58,.12),.68); place(out,1.38,click(980,.12,pan=.1),.45)
    else:
        place(out,.77,thump(.54,54,.05),1.0); place(out,1.02,click(1460,.09,pan=.05),.65)
    return add_reverb(out,CORRIDOR_IR,.17)


def elevator_travel():
    d=4.8;t=time(d); out=np.zeros((len(t),2))
    motor=(oscillator(39+5*np.sin(2*np.pi*.17*t),d)*.21+oscillator(78,d)*.055)
    rumble=filt(noise(d,"brown"),"lowpass",145)*.26
    air=filt(noise(d),"bandpass",(220,1600))*.032
    mono=(motor+rumble+air)*(envelope(len(t),.18,.55))
    out+=pan_mono(mono,0,width=.12)
    for ts in [.24,1.31,2.22,3.12]: place(out,ts,click(780,.07,pan=R.uniform(-.25,.25)),.32)
    squeal=chirp(time(.72),f0=1180,f1=690,t1=.72,method="quadratic")*envelope(nframes(.72),.06,.31)*.11
    place(out,3.62,squeal,.9,pan=.2)
    place(out,4.12,thump(.5,44,0),.7)
    return add_reverb(out,CORRIDOR_IR,.1)


def room_shift():
    """Walls, timber and plaster settling around the listener."""
    d=3.8; out=np.zeros((nframes(d),2))
    for ts,p,start_f,end_f,g in [(.05,-.55,145,78,.075),(.78,.42,118,64,.06),(1.68,-.1,92,54,.052)]:
        dur=1.55
        groan=oscillator(np.linspace(start_f,end_f,nframes(dur)),dur,"triangle")*envelope(nframes(dur),.22,.62)*g
        groan+=filt(noise(dur),"bandpass",(70,780),3)*envelope(nframes(dur),.18,.68)*g*.42
        place(out,ts,groan,1,pan=p)
    dust=filt(stereo_noise(d,"pink",.18),"bandpass",(140,1800),3)*np.sin(np.pi*np.clip(time(d)/d,0,1))[:,None]*.018
    out+=dust
    return add_reverb(out,CORRIDOR_IR,.38)


def scary_hit():
    """A soft pressure change and building resonance; no jump-scare transient."""
    d=2.4; t=time(d); out=np.zeros((nframes(d),2))
    pressure=filt(noise(d,"brown"),"lowpass",120)*envelope(nframes(d),.09,.8)*.12
    resonance=(oscillator(np.linspace(54,39,nframes(d)),d)*.12+oscillator(83,d)*.035)*np.exp(-t*1.45)
    out+=pan_mono(pressure+resonance,0,width=.16)
    settle=filt(noise(1.35),"bandpass",(110,950),3)*envelope(nframes(1.35),.16,.58)*.055
    place(out,.42,settle,1,pan=.18)
    return add_reverb(out,CORRIDOR_IR,.4)


def tonal_ui(notes, duration=.62, pan=0, dark=False):
    """Low-level analogue resonance used only beneath physical actions."""
    out=np.zeros(nframes(duration)); t=time(duration)
    for freq,at,amp in notes:
        remain=max(.08,duration-at); tt=time(remain)
        f=max(90,min(780,float(freq)*.62))
        wave=oscillator(f,remain)*np.exp(-tt*(4.5 if dark else 3.8))*amp*.42
        wave+=filt(noise(remain),"bandpass",(120,1800),3)*np.exp(-tt*6.0)*amp*.08
        start=int(at*SR); out[start:start+len(wave)]+=wave[:len(out)-start]
    out*=envelope(len(out),.012,.18)
    return add_reverb(pan_mono(out,pan,width=.06),ROOM_IR,.1)


def ambience_home():
    d=48;t=time(d); out=stereo_noise(d,"pink",.3)*.018
    rain=filt(stereo_noise(d,"white",.05),"bandpass",(650,10500))*.075
    rain*=((.66+.18*np.sin(2*np.pi*.031*t))[:,None])
    out+=rain
    out+=pan_mono(filt(noise(d,"brown"),"lowpass",130)*.055,0,width=.16)
    for _ in range(110):
        dur=R.uniform(.018,.09); drop=filt(noise(dur),"highpass",1700)*envelope(nframes(dur),.001,dur*.75)*R.uniform(.04,.16)
        place(out,R.uniform(.3,d-dur-.1),drop,1,pan=R.uniform(-.95,.95))
    for ts in [7.4,18.1,31.6,42.2]: place(out,ts,thump(.42,R.uniform(54,75),R.uniform(-.8,.8)),.08)
    return seamless(out,2.1)


def ambience_floor():
    d=46;t=time(d); out=stereo_noise(d,"brown",.22)*.045
    hum=(oscillator(50,d)*.045+oscillator(100,d)*.018)*(0.75+.12*np.sin(2*np.pi*.09*t))
    out+=pan_mono(hum,0,width=.1)
    out+=filt(stereo_noise(d,"pink",.08),"bandpass",(160,1300))*.025
    for ts in [4.3,12.7,20.4,29.8,39.1]:
        groan=(oscillator(np.linspace(R.uniform(120,180),R.uniform(75,110),nframes(2.2)),2.2,"triangle")*.13+filt(noise(2.2),"lowpass",480)*.05)*envelope(nframes(2.2),.25,.8)
        place(out,ts,groan,1,pan=R.uniform(-.8,.8))
    for ts in [8.6,24.3,34.7]: place(out,ts,click(R.uniform(550,880),.11,pan=R.uniform(-1,1)),.18)
    return seamless(out,2.4)


def ambience_building():
    d=44;t=time(d); out=filt(stereo_noise(d,"pink",.35),"lowpass",1100)*.028
    out+=pan_mono(oscillator(49.8,d)*.035,0,width=.12)
    tv=filt(noise(d),"bandpass",(280,2200))*.018*(.5+.5*np.sin(2*np.pi*.22*t))
    out+=pan_mono(tv,.68)
    for ts,p in [(5.2,-.7),(5.9,-.5),(17.8,.6),(29.4,-.2),(37.2,.75)]: place(out,ts,thump(.25,75,p),.18)
    return seamless(out,2)


def ambience_archive():
    d=42;t=time(d); out=stereo_noise(d,"pink",.45)*.018
    out+=pan_mono(oscillator(50,d)*.028+oscillator(100,d)*.01,0,width=.08)
    tape=filt(stereo_noise(d),"highpass",4500)*.008
    out+=tape
    for ts in [5.8,13.6,22.4,31.9,38.2]:
        tick=click(720,.07,pan=R.uniform(-.45,.45))
        place(out,float(ts),tick,.045)
    for ts in [9.4,25.6,35.1]:
        rustle=filt(noise(.9),"bandpass",(500,6500))*envelope(nframes(.9),.03,.3)*.08
        place(out,ts,rustle,1,pan=R.uniform(-.7,.7))
    return seamless(out,1.8)


def ambience_market():
    d=40;t=time(d); out=filt(stereo_noise(d,"pink",.3),"bandpass",(80,1700))*.027
    out+=pan_mono(oscillator(42,d)*.035,0,width=.12)
    for ts,p in [(4.1,-.8),(9.8,.7),(15.3,-.5),(23.9,.2),(34.8,.8)]:
        foot=thump(.22,R.uniform(68,84),p); place(out,ts,foot,.13)
    for ts in [12.2,30.6]: place(out,ts,click(1280,.06,pan=R.uniform(-.8,.8)),.13)
    return seamless(out,2)


def ambience_coop():
    d=42;t=time(d); out=ambience_floor()[:nframes(d)]*.72
    pulse=oscillator(33,d)*(.025+.018*(np.sin(2*np.pi*.075*t)+1)/2)
    out+=pan_mono(pulse,0,width=.14)
    for ts,p in [(6.5,-.8),(7.1,-.55),(18.8,.7),(19.45,.45),(32.1,-.25)]: place(out,ts,thump(.23,73,p),.12)
    return seamless(out,2.2)


def ambience_tension(high=False):
    d=32;t=time(d); out=stereo_noise(d,"brown",.12)*(.025 if high else .015)
    base=36 if high else 31
    out+=pan_mono(oscillator(base,d)*(.055 if high else .032),0,width=.2)
    out+=pan_mono(oscillator(base*1.505,d)*(.028 if high else .016),-.25)
    if high:
        beat=(.5+.5*np.sin(2*np.pi*1.02*t))**7
        out+=pan_mono(filt(noise(d),"lowpass",105)*beat*.045,0)
        out+=filt(stereo_noise(d,"pink",.18),"bandpass",(70,260),3)*(0.008+0.008*np.sin(2*np.pi*.071*t))[:,None]
    return seamless(out,2)


# Preserve completed assets across chunked generation runs.
write_ir("corridor-ir",CORRIDOR_IR)
write_ir("room-ir",ROOM_IR)

# Long environments. Reuse identical beds instead of regenerating them.
home_bed=ambience_home(); floor_bed=ambience_floor()
long_environments={
    "rain-window": home_bed,
    "apartment-night": home_bed,
    "floor-ambience": floor_bed,
    "eighth-floor": floor_bed,
    "building-hall": ambience_building(),
    "archive-room": ambience_archive(),
    "market-lobby": ambience_market(),
    "coop-tension": ambience_coop(),
    "tension-low": ambience_tension(False),
    "tension-high": ambience_tension(True),
}
for name, audio in long_environments.items(): write_asset(name,audio,"ambience",ogg_q=6,aac_rate="144k")

# Secondary ambience loops.
def secondary_loop(kind):
    d={"lamp-hum":28,"wind":28,"television":22,"neighbor":22,"pipes":24}[kind]; t=time(d); out=np.zeros((len(t),2))
    if kind=="lamp-hum":
        mono=(oscillator(50,d)*.16+oscillator(100,d)*.055+oscillator(150,d)*.018)*(.75+.1*np.sin(2*np.pi*.11*t)); out+=pan_mono(mono,0,width=.08)
        out+=filt(stereo_noise(d),"highpass",2500)*.009
        for ts in [3.7,9.2,16.5,23.1]: place(out,ts,click(2900,.035,pan=R.uniform(-.3,.3)),.15)
    elif kind=="wind":
        out+=filt(stereo_noise(d,"pink",.05),"bandpass",(85,1800))*(.065+.035*np.sin(2*np.pi*.061*t))[:,None]
        out+=pan_mono(oscillator(410,d)*(.007+.007*np.sin(2*np.pi*.09*t)),.35)
    elif kind=="television":
        murmur=filt(noise(d),"bandpass",(240,2200))*.028; mod=.42+.3*np.sin(2*np.pi*.27*t)+.18*np.sin(2*np.pi*.41*t)
        out+=pan_mono(murmur*mod,.72); out+=pan_mono(filt(noise(d),"highpass",4800)*.006,.75)
    elif kind=="neighbor":
        out+=filt(stereo_noise(d,"brown",.3),"lowpass",520)*.014
        for ts,p in [(2.2,.7),(2.7,.58),(8.4,-.65),(14.8,.45),(18.7,-.35)]: place(out,ts,thump(.26,R.uniform(64,84),p),.16)
    elif kind=="pipes":
        out+=filt(stereo_noise(d,"pink",.2),"bandpass",(420,3600))*.016
        for ts,p in [(2.1,-.5),(6.7,.65),(11.4,-.2),(17.8,.75),(21.1,-.7)]:
            k=tonal_ui([(R.uniform(140,210),0,.22),(R.uniform(240,360),.03,.08)],.42,p,dark=True); place(out,ts,k,.55)
    return seamless(out,1.5)

for n in ["lamp-hum","wind","television","neighbor","pipes"]: write_asset(n,secondary_loop(n),"ambience",ogg_q=6,aac_rate="112k")

# Rare spatial one-shots.
def footsteps_variant(seed):
    local=np.random.default_rng(seed); d=5.4; out=np.zeros((nframes(d),2)); p=local.uniform(-.9,.9)
    for i,ts in enumerate(np.arange(.25,5.0,local.uniform(.48,.66))):
        foot=thump(.22,local.uniform(62,82),np.clip(p+(i*.08 if p<0 else -i*.08),-1,1))
        place(out,float(ts),foot,local.uniform(.25,.42)*(1-ts/d*.45))
    return add_reverb(out,CORRIDOR_IR,.34)
for i in range(1,4): write_asset(f"footsteps-{i:02d}",footsteps_variant(800+i),"effect")
write_asset("footsteps",footsteps_variant(880),"effect")

def whisper_variant(seed):
    local=np.random.default_rng(seed); d=3.7; out=np.zeros((nframes(d),2)); p=local.uniform(-.95,.95)
    for ts in [0.35,1.55,2.55]:
        dur=local.uniform(.62,1.0); breath=filt(local.normal(0,1,nframes(dur)),"bandpass",(680,6500))*envelope(nframes(dur),.12,.42)*.11
        form=oscillator(local.choice([210,245,290]),dur)*envelope(nframes(dur),.18,.45)*.018
        place(out,ts,breath+form,1,pan=p+local.uniform(-.08,.08))
    return add_reverb(out,CORRIDOR_IR,.42)
for i in range(1,4): write_asset(f"whisper-{i:02d}",whisper_variant(900+i),"effect")
write_asset("whisper",whisper_variant(980),"effect")

# Mechanical / environmental one-shots.
write_asset("elevator-travel",elevator_travel())
write_asset("elevator",elevator_travel())
write_asset("elevator-arrive",bell(510,2.0)*.72)
write_asset("elevator-bell",bell(535,2.6))
write_asset("elevator-button",click(620,.12,pan=-.18)*.72)
brake=np.zeros((nframes(1.35),2)); friction=filt(noise(1.05),"bandpass",(90,1350),3)*envelope(nframes(1.05),.12,.5)*.10; place(brake,0,friction,1,pan=.08); place(brake,.72,thump(.5,48,.04),.32); write_asset("elevator-brake",add_reverb(brake,CORRIDOR_IR,.28))
for i,f in enumerate([420,470,510],1): write_asset(f"floor-tick-{i:02d}",click(f,.095,pan=(i-2)*.1)*.62)
write_asset("door-open",door(True)); write_asset("door-close",door(False)); write_asset("door",door(True))
write_asset("door-lock",add_reverb(click(520,.15,pan=-.1)*.68,ROOM_IR,.13))
key=np.zeros((nframes(.72),2)); scrape=filt(noise(.42),"bandpass",(180,2400),3)*envelope(nframes(.42),.04,.18)*.07; place(key,.02,scrape,1,pan=-.12); place(key,.34,click(480,.12,pan=.1),.55); write_asset("key-turn",add_reverb(key,ROOM_IR,.16))
write_asset("room-shift",room_shift()); write_asset("room",room_shift())
write_asset("danger-hit",scary_hit()); write_asset("impact",scary_hit())
camera=np.zeros((nframes(.72),2)); place(camera,.04,click(520,.1,pan=.12),.42); shutter=filt(noise(.22),"bandpass",(180,2800),3)*envelope(nframes(.22),.008,.13)*.08; place(camera,.12,shutter,1,pan=.15); place(camera,.28,click(390,.1,pan=.08),.28); write_asset("camera",add_reverb(camera,ROOM_IR,.1))
write_asset("paper",add_reverb(pan_mono(filt(noise(1.05),"bandpass",(450,8500))*envelope(nframes(1.05),.015,.24)*.28,-.15,width=.18),ROOM_IR,.08))
write_asset("page-turn",pan_mono(filt(noise(.62),"bandpass",(700,9200))*envelope(nframes(.62),.008,.28)*.24,.12,width=.21))
pickup=np.zeros((nframes(.72),2)); fabric=filt(noise(.42),"bandpass",(160,2600),3)*envelope(nframes(.42),.04,.18)*.055; place(pickup,.04,fabric,1,pan=.12); place(pickup,.36,thump(.28,84,.08),.12); write_asset("item-pickup",pickup)
item_place=np.zeros((nframes(.48),2)); place(item_place,0,thump(.48,77,-.08),.58); place(item_place,.12,click(920,.09,pan=.1),.8)
write_asset("item-place",add_reverb(item_place,ROOM_IR,.11))
write_asset("place",add_reverb(item_place,ROOM_IR,.11))
bag=np.zeros((nframes(.9),2)); zipline=filt(noise(.62),"bandpass",(220,3300),3)*envelope(nframes(.62),.05,.22)*.05; place(bag,.04,zipline,1,pan=-.12); place(bag,.55,thump(.26,76,-.08),.1); write_asset("inventory-open",bag)
# Physical feedback only: paper, fabric, relays and room pressure. No game stingers.
clue=np.zeros((nframes(1.45),2)); rustle=filt(noise(.9),"bandpass",(280,5200),3)*envelope(nframes(.9),.04,.38)*.12; place(clue,.06,rustle,1,pan=-.08); place(clue,.72,click(460,.12,pan=.12),.42); write_asset("clue-found",add_reverb(clue,ROOM_IR,.1))

breath=np.zeros((nframes(2.1),2)); exhale=filt(noise(1.7),"bandpass",(90,1200),3)*envelope(nframes(1.7),.25,.7)*.07; place(breath,.1,exhale,1,pan=-.18); place(breath,.48,thump(.75,48,0),.13); write_asset("nerve-drop",add_reverb(breath,CORRIDOR_IR,.34))
write_asset("danger-rise",scary_hit()*.58)

escape_sound=np.zeros((nframes(2.7),2)); place(escape_sound,.05,click(430,.12,pan=-.1),.42); air=filt(noise(1.9),"bandpass",(80,1600),3)*envelope(nframes(1.9),.22,.72)*.07; place(escape_sound,.38,air,1,pan=.1); place(escape_sound,1.52,door(True)*.35,.62); write_asset("escape",escape_sound)

failure_sound=np.zeros((nframes(2.8),2)); power=filt(noise(.5),"lowpass",420)*envelope(nframes(.5),.02,.3)*.08; place(failure_sound,.05,power,1); place(failure_sound,.3,scary_hit(),.5); write_asset("failure",failure_sound)

stamp=np.zeros((nframes(.95),2)); place(stamp,.08,thump(.34,74,-.04),.3); place(stamp,.16,click(390,.1,pan=.02),.42); paperbed=filt(noise(.55),"bandpass",(320,3900),3)*envelope(nframes(.55),.02,.28)*.05; place(stamp,.24,paperbed,1,pan=.05); write_asset("achievement",stamp)

binder=np.zeros((nframes(1.3),2)); paperbed=filt(noise(.7),"bandpass",(260,4300),3)*envelope(nframes(.7),.03,.3)*.07; place(binder,.02,paperbed,1,pan=-.1); place(binder,.62,thump(.45,68,.04),.28); write_asset("collection-complete",binder)

receipt=np.zeros((nframes(1.25),2)); roll=filt(noise(.72),"bandpass",(450,3800),3)*envelope(nframes(.72),.04,.24)*.055; place(receipt,.05,roll,1,pan=.08); place(receipt,.72,click(420,.11,pan=-.08),.38); write_asset("purchase-stars",receipt); write_asset("purchase",receipt)

token=np.zeros((nframes(.8),2)); slide=filt(noise(.48),"bandpass",(180,2400),3)*envelope(nframes(.48),.03,.2)*.045; place(token,.03,slide,1,pan=.12); place(token,.4,click(360,.1,pan=.18),.35); write_asset("marks",token)

pencil=np.zeros((nframes(.72),2)); stroke=filt(noise(.55),"bandpass",(420,3200),3)*envelope(nframes(.55),.06,.2)*.045; place(pencil,.05,stroke,1,pan=-.12); write_asset("vote",pencil)

note=np.zeros((nframes(1.05),2)); slide=filt(noise(.8),"bandpass",(280,3800),3)*envelope(nframes(.8),.06,.34)*.06; place(note,.05,slide,1,pan=.2); place(note,.7,thump(.26,82,.25),.12); write_asset("message-send",note)

join=np.zeros((nframes(1.25),2)); place(join,.08,door(True)*.18,.55); place(join,.72,thump(.35,66,-.25),.12); write_asset("coop-join",join)
ready=np.zeros((nframes(.9),2)); place(ready,.05,click(430,.12,pan=.12),.35); place(ready,.3,thump(.35,62,.05),.12); write_asset("coop-ready",ready)
leave=np.zeros((nframes(1.25),2)); place(leave,.05,door(False)*.16,.55); write_asset("coop-leave",leave)

reconnect_sound=np.zeros((nframes(1.5),2)); line=filt(noise(1.0),"bandpass",(150,1450),3)*envelope(nframes(1.0),.22,.42)*.035; place(reconnect_sound,.1,line,1); place(reconnect_sound,.82,click(390,.12),.28); write_asset("reconnect",reconnect_sound)

match_start=np.zeros((nframes(2.0),2)); place(match_start,.05,click(420,.13,pan=-.1),.4); place(match_start,.38,door(False)*.25,.65); write_asset("match-start",match_start)
match_end=np.zeros((nframes(2.1),2)); place(match_end,.05,click(390,.12,pan=.1),.32); place(match_end,.45,door(True)*.27,.68); write_asset("match-end",match_end)

write_asset("spectator-camera",add_reverb(click(470,.13,pan=.22)*.42,ROOM_IR,.12))
spec_light=np.zeros((nframes(.9),2)); hum=filt(noise(.6),"bandpass",(70,800),3)*envelope(nframes(.6),.12,.25)*.045; place(spec_light,.04,hum,1,pan=-.18); place(spec_light,.42,click(410,.1,pan=-.1),.28); write_asset("spectator-light",spec_light)

write_asset("radio-short",add_reverb(thump(.2,92,-.3)*.3,ROOM_IR,.24))
write_asset("radio-long",add_reverb(thump(.42,68,.3)*.34,ROOM_IR,.26))
radio_ok=np.zeros((nframes(1.35),2)); place(radio_ok,.05,click(390,.12),.3); stable=oscillator(118,1.0)*envelope(nframes(1.0),.18,.5)*.045; place(radio_ok,.24,stable,1); write_asset("radio-success",radio_ok)
radio_bad=np.zeros((nframes(1.35),2)); static=filt(noise(.9),"bandpass",(120,1400),3)*envelope(nframes(.9),.08,.48)*.035; place(radio_bad,.1,static,1); place(radio_bad,.72,click(330,.12),.24); write_asset("radio-fail",radio_bad)


# UI interaction sounds intentionally omitted in V4.3.1.


# Rare house events.
def rare(name):
    if name=="wall-scratch":
        d=2.8;x=filt(noise(d),"bandpass",(420,3400),3)*envelope(nframes(d),.15,.45)*.12*(.4+.6*np.abs(np.sin(2*np.pi*4.3*time(d)))); return add_reverb(pan_mono(x,.72),CORRIDOR_IR,.35)
    if name=="bulb-flicker":
        out=np.zeros((nframes(1.7),2));
        for ts in [.02,.18,.43,.92,1.05]: place(out,ts,click(520,.09,pan=R.uniform(-.2,.2)),.32)
        return out
    if name=="water-drip":
        out=np.zeros((nframes(2.3),2));
        for ts,p in [(.1,-.6),(.82,.45),(1.66,-.1)]: place(out,ts,tonal_ui([(1450,0,.12),(720,.03,.06)],.34,p),.7)
        return add_reverb(out,CORRIDOR_IR,.45)
    if name=="distant-door": return door(False)*.22
    if name=="distant-elevator": return elevator_travel()*.16
    if name=="pipe-knock":
        out=np.zeros((nframes(1.8),2));
        for ts,p in [(0,-.45),(.42,.42),(.95,-.1)]: place(out,ts,tonal_ui([(160,0,.18),(270,.025,.07)],.42,p,dark=True),.6)
        return add_reverb(out,CORRIDOR_IR,.4)
    if name=="intercom":
        out=np.zeros((nframes(3.7),2)); place(out,.05,tonal_ui([(690,0,.14),(960,0,.08)],.85,-.2),.65); place(out,1.55,click(480,.12,pan=.2),.4); return add_reverb(out,CORRIDOR_IR,.28)
    raise ValueError(name)
for n in ["wall-scratch","bulb-flicker","water-drip","distant-door","distant-elevator","pipe-knock","intercom"]: write_asset(n,rare(n),"effect")

# Compatibility copies are generated directly, not filesystem symlinks.

# Metadata manifest for tests, service worker prefetch and future tooling.
assets=[]
for p in sorted(OUT.iterdir()):
    if p.suffix in {".m4a",".wav"}:
        assets.append({"file":p.name,"bytes":p.stat().st_size})
import json
(OUT/"manifest.json").write_text(json.dumps({"version":"4.3.1","sampleRate":SR,"original":True,"assets":assets},ensure_ascii=False,indent=2),encoding="utf-8")

shutil.rmtree(TMP,ignore_errors=True)
print(f"Generated {len(assets)} files ({sum(a['bytes'] for a in assets)/1024/1024:.1f} MiB) in {OUT}")
