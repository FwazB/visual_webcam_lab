# body.synth — User Guide

## What is this?

body.synth is a browser-based app that lets you control music playback with your body. It uses your webcam to track your pose in real-time, then maps your movements to audio effects.

Right now, the only active control is **playback speed via a thumb-to-index pinch gesture**.

## How to use it

### 1. Start the app

```bash
cd body-synth
npm run dev
```

Open the URL shown in your terminal (usually `http://localhost:3000`).

### 2. Allow webcam access

Your browser will ask for camera permission. Grant it — the app needs your webcam to track your body. The video stays local and is never uploaded anywhere.

### 3. Load a track

Either:
- **Drag and drop** an MP3 file onto the page, or
- Click the **"Load MP3"** button in the top-right corner and select a file

### 4. Hit Play

Once the track is loaded, a green **"Play"** button appears. Click it to start playback.

### 5. Control speed with a pinch gesture

Stand so the camera can see your upper body and at least one hand. The app tracks the distance between your **thumb and index finger**:

- **Pinch thumb + index together** → song slows down (down to 0.5x)
- **Spread thumb + index apart** → song speeds up (up to 2x)
- Both hands are tracked and averaged together

You'll see a speed bar in the bottom-left corner showing the current playback rate in real-time.

### 6. Stop

Click the red **"Stop"** button to pause playback.

## What you see on screen

- **Webcam feed** — your live camera view as the background
- **Green finger markers** — dots on your thumb and index finger tips, with lines showing the pinch distance
- **Floating particles** — audio-reactive Three.js visuals that appear during playback
- **Speed bar** — bottom-left panel showing current playback speed
- **Track name** — top-right, shows which file is loaded

## Tech stack

| Layer | Technology | Role |
|-------|-----------|------|
| Framework | Next.js | App shell, deployment via Vercel |
| Pose tracking | MediaPipe Pose | 33 body landmarks from webcam in real-time |
| Audio | Tone.js | Load MP3, apply real-time effects (speed, filter, reverb, etc.) |
| Visuals | Three.js (React Three Fiber) | Audio-reactive particle system over the webcam feed |

## Tips

- **Lighting matters** — MediaPipe works best with decent lighting and a clean background. It'll still work in low light, just less accurately.
- **Stand back a bit** — the camera needs to see at least your torso and both hands. About 4-6 feet from the camera is ideal.
- **Smooth movements** — the speed control responds in real-time with slight smoothing, so gradual movements give you finer control.
- **Any audio file works** — despite the button saying "MP3", it accepts any browser-supported audio format (MP3, WAV, OGG, AAC, etc.).

## Future controls (built but currently disabled)

The codebase has additional body-to-audio mappings ready to be activated:

| Movement | Audio Effect |
|----------|-------------|
| Left hand height | Lowpass filter cutoff (100-8000 Hz) |
| Right hand height | Reverb wet/dry mix |
| Arm spread | Delay wet/dry mix |
| Movement speed | Distortion amount |
| Body lean | Stereo pan (left/right) |
| Crouch level | *(was previously speed, now replaced by finger control)* |

These can be re-enabled in `src/hooks/useAudioEngine.ts` by uncommenting the relevant lines in the `updateFromPose` function.
