# Apple Native Guitar And Bass Teacher Roadmap

## Goal

Build native Apple apps that teach regular guitar and bass guitar with spatial overlays, real-time feedback, and instrument-aware lessons.

The current web app is the prototype layer:

- `/bass` validates fretboard lesson logic and MediaPipe hand tracking.
- `/visualz` validates performance visuals, body segmentation, hand emitters, and audio-as-control.

The Apple apps should become the serious learning product.

Start with regular guitar and bass together. They share the same core fretboard engine, but differ in tuning, string count, lesson content, and ergonomics.

## Target Platforms

### iPhone And iPad

Primary live teaching target:

- iPhone 11 Pro initial test device
- Apple Developer account
- rear-camera ARKit lessons
- guitar and bass modes from the first MVP
- physical instrument in camera view

The iPhone 11 Pro is a good first test device for rear-camera ARKit work. Build the first spatial MVP around iPhone/iPad AR.

### Mac

Mac should be a first-class companion app, not just a later port.

Best Mac roles:

- lesson library and practice planner
- larger-screen fretboard explorer
- chord/scale/note trainer
- progress review
- video lesson playback beside an interactive fretboard
- optional webcam-based practice mode where ARKit is unavailable

Mac can share most non-camera logic with iPhone/iPad:

- instrument models
- fretboard math
- note/chord/scale engine
- lesson data
- scoring rules
- user progress

Mac should not block the AR MVP. Build shared Swift models first, then provide iOS/iPadOS and macOS front ends.

### visionOS Later

Consider visionOS after the iPhone/iPad MVP proves the interaction model.

## Framework Roles

### ARKit

Use ARKit for the live iPhone/iPad spatial lesson:

- camera AR session
- world tracking
- stable anchors in the room
- overlays attached to the real instrument
- fret/string target markers
- lesson UI in camera space

Official docs: https://developer.apple.com/documentation/arkit

ARKit is not the Mac teaching foundation. Mac should use a native SwiftUI/AppKit-style interface with optional webcam assistance, while iPhone/iPad own the instrument-in-space experience.

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
2. User selects `Guitar` or `Bass`.
3. Camera starts in AR mode.
4. User aligns a fretboard guide over the real neck.
5. App anchors fret/string positions.
6. User chooses a lesson: notes, scale shape, chord shape, riff, or tab.
7. App projects target positions onto the real instrument.
8. App gives simple feedback: correct, close, wrong, out of frame.

Keep MVP feedback visual first. Audio note detection can come later.

MVP 1 should support both:

- regular guitar: 6 strings, standard tuning, beginner chords, scale shapes, and 6-line tabs
- bass guitar: 4 strings, standard tuning, notes, roots/fifths/octaves, scale shapes, and 4-line bass tabs

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

Guitar defaults:

- 6 strings
- E A D G B E tuning
- 20-24 frets

Bass defaults:

- 4 strings
- E A D G tuning
- 20-24 frets

Treat both as data-driven instrument profiles, not separate apps.

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

Create one shared lesson engine that can power:

- iPhone/iPad AR overlays
- Mac fretboard trainer
- future visionOS spatial lessons

### Tab Reader And Trainer

Tabs should be a first-class lesson source for both guitar and bass.

Beginner users should not have to understand tab notation before using the app. The app should parse the tab and translate it into visual targets on the real instrument.

Support from the first tab MVP:

- 6-line regular guitar ASCII tabs
- 4-line bass guitar ASCII tabs
- per-instrument tuning profiles
- fret numbers mapped to string/fret targets
- simple left-to-right playback order
- stacked fret numbers as simultaneous notes/chords
- rests/gaps as timing spacing

Internal event model:

- instrument profile: guitar or bass
- string index
- fret number
- beat/order index
- duration estimate
- optional chord label
- optional technique marker

Early visual behavior:

- show the next target string/fret on the real neck
- animate the upcoming tab sequence left to right
- turn targets green/yellow/red based on hand position
- optionally confirm played pitch with microphone/audio input later

Later parser support:

- slides
- hammer-ons and pull-offs
- bends
- muted notes
- palm mute markers
- repeat bars
- imported Guitar Pro or MusicXML if needed

Mac-specific tab workflow:

- paste or import a tab
- clean up spacing
- choose guitar or bass profile
- preview the tab on a large fretboard
- send the lesson to iPhone/iPad AR practice

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

### Milestone 1: Shared Apple Project

- Xcode project
- shared Swift package/module for instrument and lesson models
- guitar and bass instrument profiles
- iOS/iPadOS target
- macOS target
- iPhone 11 Pro build and dev install

### Milestone 2: iPhone/iPad AR Shell

- camera permission
- ARKit session
- simple overlay plane/markers
- guitar/bass mode selector

### Milestone 3: Mac Companion Shell

- desktop fretboard view
- instrument selector
- scale/chord/note browser
- lesson list

### Milestone 4: Manual Fretboard Calibration

- bass/guitar mode
- fretboard guide
- user-set nut and neck direction
- derived fret/string grid
- save calibration

### Milestone 5: Lessons

- note finder
- major/minor scale shapes
- bass root/fifth/octave lessons
- guitar chord/scale basics
- guitar tab reader and trainer
- bass tab reader and trainer
- traffic-light feedback

### Milestone 6: Tracking Feedback

- hand/finger position approximation
- visual correctness scoring
- audio pitch detection experiment

### Milestone 7: Create ML

- collect dataset from real sessions
- train instrument/fretboard detector
- replace manual steps where model accuracy is good enough

## Repo Direction

Keep this repository clean as the product lab:

- current web prototype remains in Next.js
- native Apple work can start in a new top-level folder or a new repo
- if added here, use `apple/` for shared Apple-native work
- use `apple/GuitarTeacher/` or similar for the Xcode project
- do not mix generated Xcode build artifacts into Git

Before starting native code, add an Apple/Xcode-focused `.gitignore` section if the Xcode project lives in this repo.
