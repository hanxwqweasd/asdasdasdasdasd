#!/usr/bin/env python3
"""Generate original procedural sound assets for Eighth Floor.
No external samples are used. Requires numpy/scipy and ffmpeg for OGG export.
"""
from __future__ import annotations
import math, subprocess, wave
from pathlib import Path
import numpy as np
from scipy.signal import butter, sosfilt

SR=44100
OUT=Path(__file__).resolve().parents[1]/'public'/'audio'
OUT.mkdir(parents=True,exist_ok=True)
R=np.random.default_rng(8008)

def env(n, attack=.02, release=.15):
    e=np.ones(n,dtype=np.float32)
    a=max(1,int(SR*attack)); r=max(1,int(SR*release))
    e[:a]=np.linspace(0,1,a,endpoint=False); e[-r:]=np.linspace(1,0,r)
    return e

def filt(x, kind='low', cutoff=1000, order=3):
    ny=SR/2
    if isinstance(cutoff,tuple): wn=[cutoff[0]/ny,cutoff[1]/ny]
    else: wn=cutoff/ny
    sos=butter(order,wn,btype=kind,output='sos')
    return sosfilt(sos,x).astype(np.float32)

def normalize(x, peak=.88):
    x=np.asarray(x,dtype=np.float32)
    m=float(np.max(np.abs(x))) or 1
    return x/m*peak

def stereo(x, width=.25, delay_ms=9):
    x=np.asarray(x,dtype=np.float32)
    d=max(1,int(SR*delay_ms/1000))
    right=np.roll(x,d)*width+x*(1-width)
    right[:d]=x[:d]*(1-width)
    return np.column_stack([x,right])

def save_wav(name,x,stereo_out=False):
    x=np.asarray(x,dtype=np.float32)
    if x.ndim==1 and stereo_out:x=stereo(x)
    x=normalize(x)
    pcm=np.clip(x*32767,-32768,32767).astype('<i2')
    path=OUT/f'{name}.wav'
    with wave.open(str(path),'wb') as w:
        w.setnchannels(1 if pcm.ndim==1 else 2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    return path

def ogg(name,x,quality=4):
    wav=save_wav(name,x,stereo_out=True)
    out=OUT/f'{name}.ogg'
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(wav),'-c:a','libvorbis','-q:a',str(quality),str(out)],check=True)
    wav.unlink(missing_ok=True)

def tone(freq,dur,amp=1,phase=0):
    t=np.arange(int(SR*dur))/SR
    return (np.sin(2*np.pi*freq*t+phase)*amp).astype(np.float32)

def noise(dur): return R.normal(0,1,int(SR*dur)).astype(np.float32)

def place(buf,start,sound,gain=1):
    i=int(start*SR); j=min(len(buf),i+len(sound));
    if j>i:buf[i:j]+=sound[:j-i]*gain

# Effects
# Elevator: motor, cable rumble, relay and door arrival
D=4.6; n=int(SR*D); t=np.arange(n)/SR
motor=np.sin(2*np.pi*(42+7*np.sin(2*np.pi*.22*t))*t)*(.2+.08*np.sin(2*np.pi*.7*t))
rumble=filt(noise(D),'low',150)*.35
metal=filt(noise(D),'bandpass',(650,2200))*.045
x=(motor+rumble+metal)*env(n,.15,.55)
for ts in (.35,1.25,2.2,3.0):
    click=filt(noise(.09),'high',900)*env(int(SR*.09),.002,.06)
    place(x,ts,click,.35)
# braking squeal
sq=tone(840,.55,.18)+tone(1260,.55,.08); sq*=env(len(sq),.05,.25); place(x,3.45,sq)
save_wav('elevator',x)

# Door: latch, wooden mass, hinge friction
x=np.zeros(int(SR*2.15),np.float32)
latch=filt(noise(.12),'bandpass',(900,5000))*env(int(SR*.12),.002,.08); place(x,.02,latch,.7)
wood=filt(noise(.72),'low',420)*env(int(SR*.72),.01,.45); place(x,.16,wood,.9)
hinge=(tone(210,.9,.25)+tone(317,.9,.12))*env(int(SR*.9),.12,.3); place(x,.28,hinge)
impact=filt(noise(.18),'low',240)*env(int(SR*.18),.002,.14); place(x,1.62,impact,1.2)
save_wav('door',x)

# Room transition
x=np.zeros(int(SR*1.9),np.float32)
whoosh=filt(noise(1.7),'bandpass',(120,1800))*np.sin(np.linspace(0,np.pi,int(SR*1.7)))**2
place(x,.05,whoosh,.5)
chord=sum(tone(f,1.45,a) for f,a in [(98,.18),(147,.12),(196,.08)])*env(int(SR*1.45),.1,.65)
place(x,.35,chord)
save_wav('room',x)

# Impact scare
x=np.zeros(int(SR*1.55),np.float32)
boom=filt(noise(.7),'low',110)*env(int(SR*.7),.002,.6); place(x,0,boom,1.4)
ring=(tone(56,1.45,.55)+tone(83,1.45,.2))*env(int(SR*1.45),.003,.8); place(x,0,ring)
shard=filt(noise(.25),'high',2000)*env(int(SR*.25),.001,.2); place(x,.08,shard,.25)
save_wav('impact',x)

# Camera shutter
x=np.zeros(int(SR*.75),np.float32)
for ts,g in [(0,.8),(.08,.5),(.31,.7)]:
    click=filt(noise(.055),'high',1500)*env(int(SR*.055),.001,.035); place(x,ts,click,g)
mechanic=tone(180,.22,.18)*env(int(SR*.22),.01,.13); place(x,.12,mechanic)
save_wav('camera',x)

# Paper
x=filt(noise(1.15),'bandpass',(450,6000)); x*=env(len(x),.02,.2)*(0.25+0.75*np.sin(np.linspace(0,np.pi,len(x)))**2); save_wav('paper',x)
# Place item
x=np.zeros(int(SR*.9),np.float32); thud=filt(noise(.22),'low',330)*env(int(SR*.22),.002,.18); place(x,.05,thud,.9); scrape=filt(noise(.42),'bandpass',(300,1700))*env(int(SR*.42),.03,.22); place(x,.19,scrape,.3); save_wav('place',x)
# Purchase: restrained analog confirmation
x=np.zeros(int(SR*1.7),np.float32)
for ts,f in [(0,392),(.22,494),(.48,659),(.78,784)]:
    s=(tone(f,.42,.22)+tone(f*2,.42,.05))*env(int(SR*.42),.01,.22); place(x,ts,s)
place(x,1.04,filt(noise(.12),'high',2200)*env(int(SR*.12),.002,.08),.16)
save_wav('purchase',x)

# Bell
x=np.zeros(int(SR*2.8),np.float32)
for ts,base in [(0,880),(.52,740)]:
    b=sum(tone(base*m,2.1,a) for m,a in [(1,.45),(2.01,.18),(2.7,.08),(4.1,.035)])*env(int(SR*2.1),.002,1.7)
    place(x,ts,b)
ogg('elevator-bell',x,5)

# Ambient loops helper with edge fades
def loop_env(x,fade=.8):
    n=len(x); f=int(SR*fade); e=np.ones(n); e[:f]=np.linspace(0,1,f); e[-f:]=np.linspace(1,0,f); return x*e

# rain on window 36 s stereo
D=36; base=filt(noise(D),'bandpass',(500,7800))*.18+filt(noise(D),'low',180)*.08
# droplets
for _ in range(120):
    ts=R.uniform(0,D-.15); d=R.uniform(.025,.12); drop=filt(noise(d),'high',1200)*env(int(SR*d),.001,d*.7)*R.uniform(.06,.22); place(base,ts,drop)
# distant thunder
t=np.arange(int(SR*D))/SR; thunder=filt(noise(D),'low',70)*(.02+.03*(np.sin(2*np.pi*.025*t)+1)/2)
ogg('rain-window',loop_env(base+thunder),4)

# lamp hum 28 s
D=28;t=np.arange(int(SR*D))/SR
hum=.2*np.sin(2*np.pi*50*t)+.08*np.sin(2*np.pi*100*t)+.03*np.sin(2*np.pi*150*t)
hum*=.7+.12*np.sin(2*np.pi*.13*t)
crackle=filt(noise(D),'high',2800)*.015
for _ in range(18):
    ts=R.uniform(0,D-.06); c=filt(noise(.04),'high',1500)*env(int(SR*.04),.001,.03); place(crackle,ts,c,.25)
ogg('lamp-hum',loop_env(hum+crackle),3)

# floor ambience 42 s
D=42;x=filt(noise(D),'low',170)*.12+filt(noise(D),'bandpass',(300,1300))*.035
t=np.arange(int(SR*D))/SR;x+=tone(31,D,.1)*(0.5+0.5*np.sin(2*np.pi*.05*t))
for ts in [5.3,12.8,20.1,31.2,38.5]:
    groan=(tone(R.uniform(110,180),2.2,.16)+filt(noise(2.2),'low',420)*.08)*env(int(SR*2.2),.25,.8); place(x,ts,groan)
ogg('floor-ambience',loop_env(x),4)

# footsteps 8s
D=8;x=np.zeros(int(SR*D),np.float32)
for i,ts in enumerate(np.arange(.45,7.5,.62)):
    foot=filt(noise(.23),'low',380)*env(int(SR*.23),.003,.19)
    foot+=tone(72,.23,.13)*env(int(SR*.23),.002,.2)
    place(x,float(ts),foot,(.85 if i%2==0 else .62)*(1-ts/D*.45))
ogg('footsteps',x,4); save_wav('footsteps',x)

# pipes 14 s
D=14;x=filt(noise(D),'low',600)*.06
for ts in [1.2,4.9,8.1,11.5]:
    knock=(tone(155,.38,.25)+tone(233,.38,.1))*env(int(SR*.38),.002,.32); place(x,ts,knock)
water=filt(noise(D),'bandpass',(700,3500))*(.025+.02*np.sin(2*np.pi*.12*np.arange(int(SR*D))/SR))
ogg('pipes',loop_env(x+water),4)

# wind 18 s
D=18;t=np.arange(int(SR*D))/SR
wind=filt(noise(D),'bandpass',(90,1200))*(.08+.07*(np.sin(2*np.pi*.07*t)+1)/2)
whistle=tone(420,D,.018)*(np.sin(2*np.pi*.11*t)+1)/2
ogg('wind',loop_env(wind+whistle),4)

# television 12s distant
D=12;t=np.arange(int(SR*D))/SR
carrier=filt(noise(D),'bandpass',(250,2400))*.035
murmur=(tone(124,D,.02)+tone(181,D,.012))*(.5+.5*np.sin(2*np.pi*.34*t))
static=filt(noise(D),'high',4500)*.008
ogg('television',loop_env(carrier+murmur+static),3)

# neighbor 12 s muffled movement
D=12;x=filt(noise(D),'low',480)*.025
for ts in [1.5,2.15,6.6,9.4]:
    bump=filt(noise(.3),'low',190)*env(int(SR*.3),.003,.25); place(x,ts,bump,.55)
voice=(tone(115,2.2,.04)+tone(173,2.2,.025))*env(int(SR*2.2),.3,.5); place(x,4.0,voice)
ogg('neighbor',loop_env(x),4)

# intercom 7 s
D=7;x=filt(noise(D),'bandpass',(350,3200))*.025
buzz=tone(55,D,.035)+tone(110,D,.014); x+=buzz
for ts in [.4,3.8]:
    ring=sum(tone(f,.75,a) for f,a in [(690,.14),(950,.08)])*env(int(SR*.75),.005,.45); place(x,ts,ring)
ogg('intercom',x,4)

# whisper 9 s, nonverbal breath-formants
D=9;x=np.zeros(int(SR*D),np.float32)
for ts in [1.1,3.4,6.2]:
    d=1.35; breath=filt(noise(d),'bandpass',(700,5200))*env(int(SR*d),.12,.5)
    form=(tone(R.choice([230,270,310]),d,.03)+tone(R.choice([470,520,580]),d,.018))*env(int(SR*d),.15,.5)
    place(x,ts,breath*.12+form)
ogg('whisper',x,4)

print('Generated',len(list(OUT.iterdir())),'audio files in',OUT)
