# JSON Claude Hits

A fork of [JSON Hit Builder](https://github.com/chuckhalliday/JSON-Hit-Builder) rebuilt around a form-first, layer-by-layer workflow: rough out a song framework in blocks, refine it like sculpture, then export it to a DAW to finish.

## Sculpting workflow

1. **Form.** Pick a form template (verse/pre-chorus/chorus, verse/chorus, AABA, 12-bar blues, build/drop). Section lengths are in bars, and each section carries an energy level and a cadence target. An optional target length adds or drops whole verse/chorus cycles.
2. **Harmony.** Progressions are written first: 4-bar phrases moving tonic -> predominant -> dominant, closing on the section's cadence (authentic, half, plagal, deceptive). Applied dominants, borrowed chords, tritone subs, sevenths and passing inversions are explicit and labelled with Roman numerals. Major, minor, dorian, phrygian, lydian and mixolydian are supported.
3. **Rhythm.** 2-bar bass motifs, stated and answered (A A B A), plus the drum grid that subdivides them. Triplets are exact.
4. **Notes.** The bass is realized from the chords (chord bass notes on changes, chord tones, approach notes); chords are voice-led (close, drop-2, shell); drums follow energy, with crashes and fills at section transitions. A guide-tone line (3rds/7ths) is included as a melody scaffold.

Each section is **defined once**. Every repeat references it, so an edit to one verse lands in every verse. Each instance keeps its own energy, an optional final-chorus key lift, and drum overrides inside its fills.

Every layer of every section can be **locked** or **re-rolled** on its own. Re-rolling a layer rebuilds the unlocked layers that depend on it and nothing else. Seeds are derived per section and layer, so re-rolling the chorus drums can't change the verse. Hand edits lock the layer they touch.

**Export MIDI** downloads a type-1 Standard MIDI File: tempo, 4/4, key signature, a marker per section, GM drums on channel 10, bass, chords (with chord-symbol text events), and the guide-tone line. Logic, Cubase, Reaper and others show the section markers on their arrangement timeline.

The original groove-driven generator is still available as the "Classic" engine in the Generate menu.

### Code map

- `src/Core/` is the engine: `doc.ts` (song document), `form.ts`, `harmony.ts`, `rhythm.ts`, `bassline.ts`, `voicing.ts`, `drums.ts`, `generate.ts` (pipeline, re-roll, locks), `edits.ts`, `realize.ts` (document -> the editors' `Part[]` view), `midiFile.ts` / `exportMidi.ts`, `theory.ts`, `time.ts` (960 PPQ ticks), `seeds.ts`.
- `npm test` runs the Jest suites; `npm run build` type-checks and builds.

---

## Original README

# JSON Hit Builder

Welcome to the JSON Hit Builder, a web application dedicated to music composition and exploration. You can experience it live at [node-composer.vercel.app](https://node-composer.vercel.app). This project was initially inspired by my tinkering with Sonic Pi, a live coding music program written in Ruby for those unfamiliar.

## Overview

I set out designing this application with the idea of facilitating musical composition by generating arrays for concurrent instruments, triggered by MIDI hits from enum strings based on time-value arrays. The idea was to have an application that constructs these arrays to synchronize based on rhythmic logic and/or genre. Opting for JavaScript, my language of choice, I took the personal opportunity to delve into TypeScript, appreciating its bug avoidance and code navigation benefits.

## Evolution of the Project

Recognizing the challenges of managing multiple languages, I shifted towards reverse-engineering key functionalities of Sonic Pi. After overcoming various puzzles and deploying a basic drum machine front-end, I discovered the exciting capability of sending MIDI directly to a local DAW from a live URL in the browser.

*Note: The current MIDI functionality is tailored for Mac users. To replicate full functionality, ensure you have three buses set up on your IAC driver—Bus 1 for drums, Bus 2 for bass, and Bus 3 for chords. Recognized buses will appear in your console when you click "Use MIDI."*

## Core Features

The core functionality centers around a "groove" algorithm, a work in progress that has expanded into a web program capable of generating muliti-instrument song structures. Upon initial load, a random sequence of note lengths and rests are assigned to the bass, which combines and subdivides to generate complementary chord and drum grooves. These grooves are then processed through a series of functions, assigning note values based on a matrix of tonal music theory concepts.

## Song Structure Generation

The application randomly assigns a BPM and overall length within a range of 3-5 minutes. The resulting parts (verse, chorus, bridge) are then distributed to fill the established time, and the object is loaded into the Redux store. Users can either replace the tree entirely by customizing initial values in a form or alter parts note by note in the rendered components.

## Purpose

The primary goal of this application is to serve as a comprehensive starting point and canvas for your musical ideas. By automating the setup of tracks, it allows you to focus on infusing your art with soul rather than getting bogged down with building everything out note by note.

## Ongoing Development

The project is a work in progress, with continuous updates introducing new features and addressing bugs. I welcome all suggestions to enhance this utility and make it a more powerful tool for instant ideation of tunes.

*Happy composing!*
