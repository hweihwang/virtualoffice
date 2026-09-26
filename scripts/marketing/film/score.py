#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Hoang Pham
# SPDX-License-Identifier: AGPL-3.0-or-later
"""
A small, warm score for the launch film, synthesized so the film needs no
licensed music: a soft pad, felt-piano notes and quiet sounds on the story
beats (the mugs, the knock, the reactions). Timings follow film.ts.

Usage: score.py <out.wav> [duration]
Writes a 48 kHz stereo WAV normalized to -16 LUFS / -1.5 dBTP with ffmpeg.
"""
import subprocess
import sys
import wave

import numpy as np

SR = 48000
OUT = sys.argv[1]
DURATION = float(sys.argv[2]) if len(sys.argv) > 2 else 44.0
N = int(SR * DURATION)
rng = np.random.default_rng(7)

dry = np.zeros((2, N))
send = np.zeros((2, N))  # to the reverb


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def place(sig, at, gain, pan=0.0, wet=0.35):
    """Mixes a mono signal at a time, with equal-power pan and a reverb send."""
    start = int(at * SR)
    if start >= N:
        return
    sig = sig[: N - start]
    left = np.cos((pan + 1) * np.pi / 4)
    right = np.sin((pan + 1) * np.pi / 4)
    for ch, g in ((0, left), (1, right)):
        dry[ch, start:start + len(sig)] += sig * gain * g
        send[ch, start:start + len(sig)] += sig * gain * g * wet


def smooth(x, width):
    """A gentle moving-average low-pass."""
    if width <= 1:
        return x
    kernel = np.ones(width) / width
    return np.convolve(x, kernel, mode='same')


def piano(midi, length=4.0, velocity=1.0):
    """Felt piano: slightly inharmonic partials, soft attack, long decay."""
    f = hz(midi)
    t = np.arange(int(length * SR)) / SR
    out = np.zeros_like(t)
    brightness = 1.25 + (1 - velocity) * 0.7
    for n in range(1, 9):
        fn = n * f * np.sqrt(1 + 0.00035 * n * n)
        if fn > 9000:
            break
        decay = 2.6 / (1 + 0.7 * (n - 1)) * (1.2 if midi < 60 else 1.0)
        amp = 1 / n ** brightness
        detune = 1 + rng.uniform(-0.0006, 0.0006)
        out += amp * np.sin(2 * np.pi * fn * detune * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t / decay)
    attack = np.clip(t / 0.012, 0, 1) ** 1.5
    hammer = smooth(rng.standard_normal(len(t)), 24) * np.exp(-t / 0.012) * 0.25
    tail = np.clip((length - t) / 0.4, 0, 1)
    return (out * attack + hammer) * tail * velocity


def bell(midi, length=5.0):
    f = hz(midi)
    t = np.arange(int(length * SR)) / SR
    out = np.zeros_like(t)
    for ratio, amp, decay in ((1, 1, 3.2), (2.0, 0.45, 1.8), (2.76, 0.28, 1.2), (5.4, 0.12, 0.6), (8.93, 0.05, 0.3)):
        if f * ratio < 12000:
            out += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / decay)
    return out * np.clip(t / 0.004, 0, 1) * np.clip((length - t) / 0.3, 0, 1)


def pad(notes, start, end, gain=0.05):
    gain *= 0.62
    """A soft pad chord with slow swells and a little movement."""
    length = end - start + 3.0
    t = np.arange(int(length * SR)) / SR
    env = np.clip(t / 1.8, 0, 1) ** 2 * np.clip((end - start + 2.4 - t) / 2.4, 0, 1)
    for i, midi in enumerate(notes):
        f = hz(midi)
        voice = np.zeros_like(t)
        for cents in (-5, 0, 6):
            fd = f * 2 ** (cents / 1200)
            phase = rng.uniform(0, 2 * np.pi)
            voice += np.sin(2 * np.pi * fd * t + phase) + 0.28 * np.sin(4 * np.pi * fd * t + phase) + 0.08 * np.sin(6 * np.pi * fd * t + phase)
        trem = 1 + 0.12 * np.sin(2 * np.pi * (0.13 + 0.03 * i) * t + i)
        pan = (i / max(1, len(notes) - 1) - 0.5) * 0.9
        weight = 1.25 if midi < 50 else 1.0
        place(voice * env * trem / 3, start, gain * weight, pan, wet=0.55)


def ting(at, gain=0.05):
    t = np.arange(int(1.2 * SR)) / SR
    out = np.zeros_like(t)
    for ratio, amp, decay in ((1, 1, 0.55), (2.32, 0.5, 0.3), (4.25, 0.25, 0.16), (6.63, 0.1, 0.08)):
        out += amp * np.sin(2 * np.pi * 2350 * ratio * t) * np.exp(-t / decay)
    out *= np.clip(t / 0.002, 0, 1)
    place(out, at, gain, 0.05, wet=0.5)
    place(out * 0.6, at + 0.018, gain, -0.1, wet=0.5)  # the second mug


def knock(at, gain=0.2):
    t = np.arange(int(0.25 * SR)) / SR
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.05) + 0.5 * np.sin(2 * np.pi * 340 * t) * np.exp(-t / 0.03)
    tap = smooth(rng.standard_normal(len(t)), 10) * np.exp(-t / 0.006) * 0.6
    place((body + tap) * np.clip(t / 0.0015, 0, 1), at, gain, 0.25, wet=0.3)


def pop(at, gain=0.06, f0=820, f1=540, pan=0.0):
    t = np.arange(int(0.18 * SR)) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.025)
    phase = 2 * np.pi * np.cumsum(f) / SR
    out = np.sin(phase) * np.exp(-t / 0.045) * np.clip(t / 0.003, 0, 1)
    place(out, at, gain, pan, wet=0.35)


def tick(at, gain=0.05):
    t = np.arange(int(0.05 * SR)) / SR
    out = np.sin(2 * np.pi * 1900 * t) * np.exp(-t / 0.006) + smooth(rng.standard_normal(len(t)), 6) * np.exp(-t / 0.003) * 0.3
    place(out, at, gain, 0.2, wet=0.25)


def air(start, end, gain=0.02):
    """A soft swell of air under the Talk reveal."""
    length = end - start
    t = np.arange(int(length * SR)) / SR
    noise = smooth(smooth(rng.standard_normal(len(t)), 40), 40)
    env = np.sin(np.pi * np.clip(t / length, 0, 1)) ** 2
    place(noise * env / (np.abs(noise).max() + 1e-9), start, gain, 0.0, wet=0.8)


def keys(notes, gain=0.16, length=4.5):
    """(time, midi[, velocity]) felt-piano notes."""
    for note in notes:
        at, midi = note[0], note[1]
        velocity = note[2] if len(note) > 2 else 0.8
        pan = np.clip((midi - 66) / 30, -0.5, 0.5)
        place(piano(midi, length, velocity), at, gain, pan, wet=0.4)


# Harmony, one chord per story beat.
pad([41, 57, 60, 64, 67], 0.6, 11.8, 0.05)           # F maj9: the light, the coffee
pad([45, 55, 60, 64], 11.8, 18.3, 0.05)              # A m7: the wave
pad([38, 53, 57, 60, 64], 18.3, 23.7, 0.05)          # D m9: the knock
pad([46, 53, 57, 62, 64], 23.7, 27.4, 0.05)          # B♭ maj7♯11: the note
pad([48, 55, 60, 62], 27.4, 30.0, 0.05)              # C sus2: the pull back
pad([41, 53, 57, 60, 64, 67], 30.0, 34.4, 0.055)     # F maj9: the title
pad([38, 53, 57, 60, 64], 34.4, 36.3, 0.045)         # D m9: Talk opens
pad([46, 53, 57, 62, 65], 36.3, 38.5, 0.045)         # B♭ maj9
pad([48, 53, 55, 60], 38.5, 40.0, 0.045)             # C sus4
pad([41, 53, 57, 60, 67], 40.0, 42.4, 0.05)          # F add9: the logo

# Felt piano, sparse.
keys([
    (2.9, 76, 0.55),
    (5.95, 69), (6.4, 72), (7.4, 76, 0.7), (8.4, 74, 0.6),
    (11.9, 76), (12.4, 72), (13.5, 69, 0.7), (14.4, 67, 0.6), (15.6, 64, 0.55),
    (18.35, 77, 0.7), (19.7, 69, 0.6), (21.4, 74, 0.65), (22.5, 72, 0.55),
    (24.8, 77, 0.65), (25.7, 76, 0.6), (26.6, 72, 0.55),
    (27.5, 67, 0.55), (27.95, 72, 0.6), (28.4, 76, 0.65), (28.85, 79, 0.7),
    (30.0, 53, 0.7), (30.03, 65, 0.7), (30.06, 69, 0.75), (30.09, 72, 0.8), (30.12, 76, 0.85),
    (31.15, 79, 0.85), (32.6, 81, 0.6), (33.4, 79, 0.55),
    (34.5, 74, 0.6), (35.3, 77, 0.6), (36.3, 76, 0.6), (37.2, 72, 0.55), (38.5, 67, 0.55), (39.2, 72, 0.6),
    (40.0, 53, 0.7), (40.04, 65, 0.7), (40.08, 72, 0.75), (40.12, 81, 0.8),
    (42.0, 81, 0.45),
])
place(bell(89, 5), 3.0, 0.035, 0.2, wet=0.7)          # the light resolves
place(bell(77, 6), 40.0, 0.05, -0.1, wet=0.6)         # the logo
place(bell(81, 6), 40.02, 0.035, 0.15, wet=0.6)
place(bell(84, 6), 40.04, 0.03, 0.3, wet=0.6)

# Sounds on the beats.
ting(6.8)
pop(12.08, 0.05, pan=-0.3)                            # Bảo waves
pop(12.88, 0.045, 900, 600, pan=0.35)                 # Gus waves back
knock(18.55)
knock(18.79, 0.17)
pop(18.97, 0.035, 700, 520)                           # the knock card
tick(20.3)
place(bell(88, 1.5), 20.95, 0.018, 0.2, wet=0.5)      # the reply
place(bell(93, 1.5), 21.05, 0.014, 0.25, wet=0.5)
place(bell(86, 2.0), 23.95, 0.016, 0.3, wet=0.6)      # Dana's note
pop(31.3, 0.05, 880, 600, pan=-0.2)                   # the shared heart
air(33.9, 37.2)
for i, midi in enumerate((84, 86, 89, 91, 93, 96)):  # the cast hops in
    place(bell(midi, 0.8), 41.0 + i * 0.075, 0.012, -0.5 + i * 0.2, wet=0.5)

# Reverb: a soft room, darker as it decays.
ir_len = int(3.2 * SR)
t = np.arange(ir_len) / SR
ir = np.zeros((2, ir_len))
for ch in range(2):
    noise = rng.standard_normal(ir_len)
    bright = noise * np.exp(-t / 0.35)
    dark = smooth(noise, 18) * np.exp(-t / 0.9)
    ir[ch] = bright * 0.35 + dark * 1.0
    ir[ch, : int(0.022 * SR)] = 0  # pre-delay
    ir[ch] /= np.sqrt(np.sum(ir[ch] ** 2))
size = 1 << int(np.ceil(np.log2(N + ir_len)))
wet = np.zeros_like(dry)
for ch in range(2):
    wet[ch] = np.fft.irfft(np.fft.rfft(send[ch], size) * np.fft.rfft(ir[ch], size), size)[:N]
mix = dry + wet * 0.9

# Gentle master: fade in and out, soft saturation for safety.
tt = np.arange(N) / SR
mix *= np.clip(tt / 0.4, 0, 1) * np.clip((DURATION - 0.15 - tt) / 1.4, 0, 1)
mix /= np.abs(mix).max() + 1e-9
mix = np.tanh(mix * 0.9) / np.tanh(0.9) * 0.7

raw = OUT + '.raw.wav'
with wave.open(raw, 'wb') as f:
    f.setnchannels(2)
    f.setsampwidth(2)
    f.setframerate(SR)
    f.writeframes((mix.T * 32767).astype('<i2').tobytes())

# Loudness: two-pass loudnorm to -16 LUFS integrated, -1.5 dBTP.
measure = subprocess.run(['ffmpeg', '-hide_banner', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
import json  # noqa: E402
stats = json.loads(measure[measure.rindex('{'):measure.rindex('}') + 1])
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af',
                f"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}:linear=true",
                '-ar', str(SR), OUT], check=True)
subprocess.run(['rm', '-f', raw])
print(f"score: {OUT} (input {stats['input_i']} LUFS, true peak {stats['input_tp']} dB)")
