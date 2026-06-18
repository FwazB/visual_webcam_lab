# Apple Native Bass And Guitar Teacher Roadmap

## Goal

Build a native Apple app that teaches bass guitar and regular guitar with spatial overlays, real-time feedback, and instrument-aware lessons.

The current web app is the prototype layer:

- `/bass` validates fretboard lesson logic and MediaPipe hand tracking.
- `/visualz` validates performance visuals, body segmentation, hand emitters, and audio-as-control.

The Apple app should become the serious learning product.

## Test Device

Initial hardware target:

- iPhone 11 Pro
- Apple Developer account
- Physical bass guitar first
- Regular guitar support after the fretboard model generalizes

The iPhone 11 Pro is a good first test device for rear-camera ARKit work. Build the MVP around iPhone/iPad AR first, then consider visionOS later.

## Framework Roles

### ARKit

Use ARKit for the live spatial lesson:

- camera AR session
- world tracking
- stable anchors in the room
- overlays attached to the real instrument
- fret/string target markers
- lesson UI in camera space

Official docs: https://developer.apple.com/documentation/arkit

### Vision

Use Vision where it is simpler than a custom model:

- 2D rectangle/contour detection
- image observations for instrument/fretboard detection experiments
- frame preprocessing before model inference

### Create ML

Use Create ML after the first AR prototype, not before it.

Likely model candidates:

- instrument detector: bass vs guitar vs no instrument
- fretboard/neck detector
- hand-position quality classifier
- posture or lesson-state classifier

Official docs: https://developer.apple.com/documentation/createml/

Do not block the MVP on custom ML. Start with manual or semi-automatic calibration, then collect training data from real sessions.

## MVP 1: AR Fretboard Overlay

Primary user flow:

1. User opens the app.
2. User selects `Bass` or `Guitar`.
3. Camera starts in AR mode.
4. User aligns a fretboard guide over the real neck.
5. App anchors fret/string positions.
6. User chooses a lesson: notes, scale shape, chord shape, or riff.
7. App projects target positions onto the real instrument.
8. App gives simple feedback: correct, close, wrong, out of frame.

Keep MVP feedback visual first. Audio note detection can come later.

## Core Technical Pieces

### Fretboard Model

Represent each instrument as:

- tuning
- string count
- fret count
- scale length assumptions
- fret spacing curve
- note map
- playable lesson shapes

Bass defaults:

- 4 strings
- E A D G tuning
- 20-24 frets

Guitar defaults:

- 6 strings
- E A D G B E tuning
- 20-24 frets

### Calibration

Start with guided calibration:

- user marks nut
- user marks bridge direction or 12th fret
- user confirms string side
- app derives fret spacing and string lanes

Later improvement:

- auto-detect fretboard from camera
- Create ML model for neck/fretboard bounds
- per-instrument saved calibration profiles

### Lesson Engine

Share concepts with the web `/bass` route:

- key selection
- shape selection
- fret/string target positions
- match scoring
- traffic-light feedback

Native app should eventually move this into Swift models, but the current TypeScript logic is useful as product reference.

### Feedback

Useful early feedback:

- target fret lights up
- correct finger/position turns green
- close position turns yellow
- wrong string/fret turns red
- out-of-frame prompts repositioning

Avoid complex grading until the tracking is stable.

## Create ML Data Plan

Collect data only after MVP calibration works:

- short videos/images of bass and guitar necks
- varied lighting
- varied body angles
- different finishes/colors
- fretted and open-hand positions
- positive and negative examples

Labeling targets:

- instrument type
- fretboard bounding region
- headstock/body optional
- hand/finger quality states

## Suggested Milestones

### Milestone 1: Native Shell

- Xcode project
- camera permission
- ARKit session
- simple overlay plane/markers
- iPhone 11 Pro build and TestFlight/dev install

### Milestone 2: Manual Fretboard Calibration

- bass/guitar mode
- fretboard guide
- user-set nut and neck direction
- derived fret/string grid
- save calibration

### Milestone 3: Lessons

- note finder
- major/minor scale shapes
- bass root/fifth/octave lessons
- guitar chord/scale basics
- traffic-light feedback

### Milestone 4: Tracking Feedback

- hand/finger position approximation
- visual correctness scoring
- audio pitch detection experiment

### Milestone 5: Create ML

- collect dataset from real sessions
- train instrument/fretboard detector
- replace manual steps where model accuracy is good enough

## Repo Direction

Keep this repository clean as the product lab:

- current web prototype remains in Next.js
- native Apple work can start in a new top-level folder or a new repo
- if added here, use `ios/` for the Xcode project
- do not mix generated Xcode build artifacts into Git

Before starting native code, add an iOS-focused `.gitignore` section if the Xcode project lives in this repo.
