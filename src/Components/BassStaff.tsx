import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import playBass from '../Playback/playBass';
import { setBassState, setCurrentBeat, SongState } from '../reducers';
import { PlayHandle } from './Piano';
import { useLampStep } from '../Playback/useLampStep';
import appStyles from '../Styles/App.module.scss';
import { NoteLocation } from '../types';
import { isStaffPitch, PITCH_MIN_Y } from '../SongStructure/bassPitch';
import { spellPc, staffY } from '../Core/theory';
import { parseKeyString } from '../Core/exportMidi';

// Standard 4-string bass tuning (E1 A1 D2 G2), lowest to highest, expressed as
// the real MIDI note number of each open string - matches the `midi` values
// already stored on notes (see bassPitch.ts), so no pixel/pitch translation
// is needed here.
const BASS_OPEN_MIDI = [28, 33, 38, 43];

// Fixed vertical unit for one diatonic staff step. This is baked into every
// note's stored `y` (and into bassPitch.ts's switch keys), so it must never
// change - existing songs' note positions depend on it.
const SPACING = 7.5;
// Pitch-space y bounds a note can be placed at: 0 is the 3rd ledger line
// above the staff (G3), 120 is the 1st ledger line below it (E1) - bass is a
// transposing instrument, so the open low E string already lands just one
// ledger line under the staff and is the lowest note a 4-string bass can
// produce, so the range doesn't extend any further down. Everything in
// between lines up with a case in bassPitch.ts.
// Highest placeable pitch: F4, three more ledger lines up (bassPitch.ts) -
// room for the top of a 20-fret neck (Eb4 on the G string).
const NOTE_MIN_Y = PITCH_MIN_Y;
const NOTE_MAX_Y = 120;
// Canvas-pixel margin above/below the mapped pitch range, so noteheads and
// accidental symbols at the extremes have room to render without clipping.
const STAFF_Y_OFFSET = 45;
const CANVAS_HEIGHT = NOTE_MAX_Y + STAFF_Y_OFFSET * 2;
// Pitch-space y of the 5 main staff lines (A2 F2 D2 B1 G1, top to bottom),
// of the 3 extra ledger lines above them (reachable via frets further up the
// neck), and of the single ledger line below (the open low E string).
const MAIN_LINES_Y = [45, 60, 75, 90, 105];
const LEDGER_LINES_ABOVE_Y = [30, 15, 0, -15, -30, -45];
const LEDGER_LINES_BELOW_Y = [120];

// Horizontal position of each tab line, top to bottom (G D A E) - vertically
// centered in the (now taller, to fit the bass staff's ledger lines) canvas
// so switching views doesn't look lopsided.
const TAB_LINE_Y = [52.5, 67.5, 82.5, 97.5].map((y) => y + STAFF_Y_OFFSET);

type TabPosition = { stringIndex: number; fret: number };

// Frets at or below this are considered an easy, open-ish position - used to
// pick a sensible starting spot when there's no previous note to stay close to.
const COMFORTABLE_FRET_SPAN = 12;
const MAX_FRET = 20;

function candidateTabPositions(midi: number): TabPosition[] {
  const candidates: TabPosition[] = [];
  BASS_OPEN_MIDI.forEach((open, i) => {
    const fret = midi - open;
    if (fret >= 0 && fret <= MAX_FRET) {
      candidates.push({ stringIndex: i, fret });
    }
  });
  return candidates;
}

// Clamps into a playable position when a note falls outside every string's
// 0-20 fret range, rather than rendering nothing.
function clampedTabPosition(midi: number): TabPosition {
  let closestIndex = 0;
  let closestDistance = Infinity;
  BASS_OPEN_MIDI.forEach((open, i) => {
    const fret = midi - open;
    const distance = fret < 0 ? -fret : fret - MAX_FRET;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = i;
    }
  });
  const clampedFret = Math.min(MAX_FRET, Math.max(0, midi - BASS_OPEN_MIDI[closestIndex]));
  return { stringIndex: closestIndex, fret: clampedFret };
}

// Picks a string/fret for `midi`. With a previous note in hand, stays as close
// as possible to that fret (minimizing hand movement across a phrase),
// favoring the lower string on ties. With no previous note (start of a part,
// or after a rest), favors the lowest string that lands in a comfortable
// low position rather than always reaching for the highest string.
function midiToTabPosition(midi: number, previous: TabPosition | null): TabPosition | null {
  if (midi <= 0) return null;

  const candidates = candidateTabPositions(midi);
  if (candidates.length === 0) return clampedTabPosition(midi);

  if (previous) {
    let best = candidates[0];
    let bestCost = Infinity;
    candidates.forEach((candidate) => {
      const fretCost = Math.abs(candidate.fret - previous.fret);
      const stringChangeCost = Math.abs(candidate.stringIndex - previous.stringIndex) * 0.1;
      const cost = fretCost + stringChangeCost;
      if (cost < bestCost || (cost === bestCost && candidate.stringIndex < best.stringIndex)) {
        best = candidate;
        bestCost = cost;
      }
    });
    return best;
  }

  const lowestComfortable = candidates
    .filter((c) => c.fret <= COMFORTABLE_FRET_SPAN)
    .sort((a, b) => a.stringIndex - b.stringIndex)[0];
  if (lowestComfortable) return lowestComfortable;

  return candidates.sort((a, b) => a.stringIndex - b.stringIndex)[0];
}

// Tab position of every note of a part, left to right: a hand-picked string
// when the note has one (and it's playable there), otherwise the closest
// comfortable position to the previous note.
function tabPositions(notes: NoteLocation[]): Array<TabPosition | null> {
  let previous: TabPosition | null = null;
  return notes.map((note) => {
    if (note.midi <= 0) return null;
    const fret = note.string !== undefined ? note.midi - BASS_OPEN_MIDI[note.string] : -1;
    const position = fret >= 0 && fret <= MAX_FRET
      ? { stringIndex: note.string!, fret }
      : midiToTabPosition(note.midi, previous);
    if (position) previous = position;
    return position;
  });
}

// Tab rows are drawn top (G) to bottom (E); strings are numbered from low E.
const rowOfString = (stringIndex: number) => BASS_OPEN_MIDI.length - 1 - stringIndex;

interface BassStaffProps {
  renderWidth: number;
  part: number;
  lampsRef: React.MutableRefObject<HTMLInputElement[]>;
  onPlayingChange?: (isPlaying: boolean) => void;
  viewMode: 'staff' | 'tab';
  onViewModeChange: (viewMode: 'staff' | 'tab') => void;
}


// Loaded once for every staff instead of on every render.
const CLEF_IMAGE = new Image();
CLEF_IMAGE.src = "/BassClef.png";

const BassStaff = forwardRef<PlayHandle, BassStaffProps>(function BassStaff({ renderWidth, part, lampsRef, onPlayingChange, viewMode, onViewModeChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dispatch = useDispatch()

  const song = useSelector((state: { song: SongState }) => state.song);
  const bpm = song.bpm
  const midi = song.midi
  const acoustic = song.acoustic
  const beat = song.selectedBeat[2]

  const bassGrid = song.songStructure[part].bassGrid
  const bassNoteGrid = song.songStructure[part].bassNoteLocations
  const bassGroove = song.songStructure[part].bassGroove
  const drumGroove = song.songStructure[part].drumGroove
  const chordsGroove = song.songStructure[part].chordsGroove
  const chords = song.songStructure[part].chords
  const chordGrid = song.songStructure[part].chordsLocation
  const measureLines = song.songStructure[part].measureLines

  const handleStep = useLampStep(lampsRef, part, drumGroove, bassGroove, chordsGroove);

  const [pendingNote, setPendingNote] = React.useState<{ x: number, y: number } | null>(null);
  // The tab cell being typed into: a note (by x) on one string.
  const [tabEdit, setTabEdit] = useState<{ x: number, stringIndex: number, value: string } | null>(null);
  const skipBlurCommit = useRef(false);

  useEffect(() => {
    setPendingNote(null);
    setTabEdit(null);
  }, [part, viewMode]);

  // One mouse record for the component's lifetime. It used to be a fresh
  // object every render, and since it sat in the effect dependency lists
  // below, every render (one per playback step) re-ran them.
  const MOUSE = useRef({
    x: -10,
    y: -10,
    isDown: false
  }).current;

  // Redraw on demand, coalesced to one frame. The staff used to start a new
  // never-cancelled requestAnimationFrame loop on every render; during
  // playback that piled up dozens of full-canvas redraw loops per part and
  // starved the main thread until playback skipped and stalled.
  const drawRef = useRef<() => void>(() => {});
  const frameRef = useRef(0);
  const requestDraw = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      drawRef.current();
    });
  }, []);


  function mouseX(array: number[]) {
    let closest = array[0]; // Assume first element is closest initially
    let minDistance = Math.abs(MOUSE.x - closest);
  
    for (let i = 1; i < array.length; i++) {
      const distance = Math.abs(MOUSE.x - array[i]);
      if (distance < minDistance) {
        closest = array[i];
        minDistance = distance;
      }
    }
  
    return closest;
  }

  const ACCIDENTAL_SYMBOLS: Record<string, string> = { flat: '♭', sharp: '#', none: '♮' };

  function getAccidentalOptions(acc: string): string[] {
    return ['flat', 'none', 'sharp'].filter((a) => a !== acc);
  }

  function getAccidentalOptionLayout(location: { x: number, y: number, acc: string }, spacing: number, fontSize: number) {
    const x = location.x + spacing * -3.5;
    const baseY = location.y + STAFF_Y_OFFSET - spacing * 2 + fontSize;
    const gap = fontSize + 6;
    return getAccidentalOptions(location.acc).map((acc, i) => ({
      acc,
      symbol: ACCIDENTAL_SYMBOLS[acc],
      x,
      y: baseY + (i === 0 ? -gap : gap)
    }));
  }

  function drawAccidentalOptions(ctx: CanvasRenderingContext2D, location: { x: number, y: number, acc: string }, spacing: number) {
    const fontSize = 20;
    ctx.font = `${fontSize}px serif`;
    ctx.fillStyle = "black";
    getAccidentalOptionLayout(location, spacing, fontSize).forEach((opt) => {
      ctx.fillText(opt.symbol, opt.x, opt.y);
    });
  }

  function drawClef(ctx: CanvasRenderingContext2D, location: { x: number, y: number, acc: string }) {
    const CANVAS = canvasRef.current;
    if (CANVAS) {
      const aspectRatio = CLEF_IMAGE.width / CLEF_IMAGE.height;
      // Fixed to the 5-line staff's own size, not the canvas's - the canvas
      // is now taller than the staff to fit the ledger lines above/below it.
      const newHeight = 78;
      const newWidth = aspectRatio * newHeight;

      ctx.drawImage(CLEF_IMAGE,
        location.x - newWidth / 2, location.y - newHeight / 2,
        newWidth, newHeight);
    }
  }

  // Short ledger-line segments through/around a single note, matching printed
  // sheet music: a note ON a ledger line gets a line through it, a note in
  // the space beyond one gets the line(s) it "steps over" but not one
  // through itself. Nothing is drawn for notes within the 5-line staff.
  function drawLedgerLines(ctx: CanvasRenderingContext2D, location: { x: number, y: number }) {
    const staffTop = MAIN_LINES_Y[0];
    const staffBottom = MAIN_LINES_Y[MAIN_LINES_Y.length - 1];
    const needed =
      location.y < staffTop ? LEDGER_LINES_ABOVE_Y.filter((y) => y >= location.y) :
      location.y > staffBottom ? LEDGER_LINES_BELOW_Y.filter((y) => y <= location.y) :
      [];
    if (needed.length === 0) return;

    const halfWidth = SPACING + 4;
    ctx.save();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    needed.forEach((pitchY) => {
      const y = pitchY + STAFF_Y_OFFSET;
      ctx.beginPath();
      ctx.moveTo(location.x - halfWidth, y);
      ctx.lineTo(location.x + halfWidth, y);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawNote(ctx: CanvasRenderingContext2D, location: { x: number, y: number, acc: string }) {
    const CANVAS = canvasRef.current;
    let match = false
    let index = 0
    for (let i = 1; i < bassGrid.length; i++){
      if (location.x === bassGrid[i]){
        match = true;
        index = i - 1;
        break;
      }
    }
    if (CANVAS && match) {
      const spacing = SPACING;
      const groove = bassGroove[index];
      ctx.fillStyle = "black";
      ctx.strokeStyle = "black";
      ctx.lineWidth = 1;

      const fontSize = 20;
      ctx.font = `${fontSize}px serif`;

      //draw notes
      if (isStaffPitch(location.y)) {
        // location.y is pitch-space (unshifted, as stored on the note); `py`
        // is where that pitch actually lands on the canvas.
        const py = location.y + STAFF_Y_OFFSET;
        drawLedgerLines(ctx, location);
        // Notes above the staff's top ledger lines take their stem (and
        // flags) downward, mirrored about the notehead, so they stay on the
        // canvas.
        const stemDown = location.y < 0;
        ctx.save();
        if (stemDown) {
          ctx.translate(0, 2 * py);
          ctx.scale(1, -1);
        }
        //add line for notes up to dotted half
        if (groove <= 2.5) {
          ctx.beginPath();
          ctx.moveTo(location.x + spacing,
            py);
          ctx.lineTo(location.x + spacing,
            py - spacing * 5);
          ctx.stroke();
          }
          //add flag for notes smaller than quarter note
          if(groove < 1){
            ctx.beginPath();
            ctx.moveTo(location.x + spacing,
              py - spacing * 5);
            ctx.bezierCurveTo(
              location.x + spacing * 2, py - spacing * 3,
              location.x + spacing * 2.5, py - spacing * 3,
              location.x + spacing * 2.5, py - spacing * 1);
            ctx.bezierCurveTo(
              location.x + spacing * 2.5, py - spacing * 2.7,
              location.x + spacing * 2, py - spacing * 2.7,
              location.x + spacing, py - spacing * 4.5);
            ctx.stroke();
            ctx.fill();
          }
          //add double flag for sixteenth notes
          if(groove === 0.25){
            ctx.beginPath();
            ctx.moveTo(location.x + spacing, py - spacing * 5 + 8);
            ctx.bezierCurveTo(
              location.x + spacing * 2, py - spacing * 3 + 7,
              location.x + spacing * 2.5, py - spacing * 3 + 7,
              location.x + spacing * 2.5, py - spacing * 1 + 4);
            ctx.bezierCurveTo(
              location.x + spacing * 2.5, py - spacing * 2.7 + 7,
              location.x + spacing * 2, py - spacing * 2.7 + 7,
              location.x + spacing, py - spacing * 4.5 + 4);
            ctx.stroke();
            ctx.fill();
          }
        ctx.restore();
        if (location.acc === 'flat') {
          ctx.fillText('♭', location.x + spacing * -3.5, py - spacing * 2 + fontSize);
        }
        if (location.acc === 'sharp') {
          ctx.fillText('#', location.x + spacing * -2.5, py - spacing * 1.9 + fontSize );
        }
        //add dots for syncopated notes
        if (groove === 2.5 || groove === 1.5 || groove === 0.75) {
          ctx.beginPath();
          ctx.arc(location.x + spacing + 8, py - 3.8, 2.8, 0, Math.PI * 2);
          ctx.fill();
        }
        //draw actual note
        ctx.beginPath();
        ctx.save();
        ctx.translate(location.x, py);
        ctx.rotate(-0.2);
        ctx.scale(1.05, 0.8);
        ctx.arc(0, 0, spacing, 0, Math.PI * 2);

        //half to quarter note fill
        if(groove <= 1.5){
          ctx.fill();
        }
      //draw rests
      } else {
        // Rests aren't pitched, so they're always drawn centered on the
        // staff regardless of location - these pixel values are tuned
        // relative to the (now offset) staff center, not location.y.
        const REST_Y = STAFF_Y_OFFSET;
        //half rest
        if (groove <= 2) {
          if (groove === 2) {
            ctx.beginPath();
            ctx.moveTo(location.x + spacing,
              REST_Y + 75);
            ctx.lineTo(location.x + spacing,
              REST_Y + 68);
            ctx.lineTo(location.x - spacing,
              REST_Y + 68);
            ctx.lineTo(location.x - spacing,
              REST_Y + 75);
            ctx.stroke()
            ctx.fill();
            //draw quarter rest
          } else if (groove >= 1) {
            ctx.beginPath();
            ctx.moveTo(location.x - 5, REST_Y + 51);
            ctx.lineTo(location.x + 5, REST_Y + 66);
            ctx.lineTo(location.x + 1, REST_Y + 75);
            ctx.lineTo(location.x + 7, REST_Y + 87);
            ctx.quadraticCurveTo(location.x - 6, REST_Y + 83, location.x + 4, REST_Y + 98)
            ctx.quadraticCurveTo(location.x - 15, REST_Y + 79, location.x + 4, REST_Y + 83)
            ctx.lineTo(location.x - 5, REST_Y + 69)
            ctx.quadraticCurveTo(location.x + 5, REST_Y + 68, location.x - 5, REST_Y + 52)
            ctx.fillStyle = "black";
            ctx.fill();
            ctx.stroke();
            //dotted quarter
            if (groove === 1.5) {
              ctx.beginPath();
              ctx.arc(location.x + 12, REST_Y + 70, 2.8, 0, Math.PI * 2);
              ctx.fill();
            }
          } else if (groove < 1) {
            //eighth
            ctx.beginPath();
            ctx.moveTo(location.x - 1, REST_Y + 88);
            ctx.lineTo(location.x + 8, REST_Y + 65);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(location.x - 6, REST_Y + 67, 3.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(location.x - 8, REST_Y + 69);
            ctx.quadraticCurveTo(location.x - 5, REST_Y + 72, location.x + 8, REST_Y + 65);
            ctx.stroke();
            //dotted eigth
            if (groove === 0.75) {
              ctx.beginPath();
              ctx.arc(location.x + 14, REST_Y + 67, 2.8, 0, Math.PI * 2);
              ctx.fill();
            }
            //sixteenth rest
            if(groove === 0.25) {
              ctx.beginPath();
              ctx.moveTo(location.x - 6, REST_Y + 103);
              ctx.lineTo(location.x + 8, REST_Y + 65);
              ctx.stroke();

              ctx.beginPath();
              ctx.arc(location.x - 6, REST_Y + 67, 3.5, 0, Math.PI * 2);
              ctx.fill();

              ctx.beginPath();
              ctx.moveTo(location.x - 8, REST_Y + 69);
              ctx.quadraticCurveTo(location.x - 5, REST_Y + 72, location.x + 8, REST_Y + 65);
              ctx.stroke();

              ctx.beginPath();
              ctx.arc(location.x - 9, REST_Y + 82, 3.5, 0, Math.PI * 2);
              ctx.fill();

              ctx.beginPath();
              ctx.moveTo(location.x - 10, REST_Y + 83);
              ctx.quadraticCurveTo(location.x - 8, REST_Y + 87, location.x + 2, REST_Y + 81);
              ctx.stroke();
            }
          }
        }
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function displayChord(ctx: CanvasRenderingContext2D, location: number, bassGrid: number[], chordName: string) {
    const CANVAS = canvasRef.current;
    if (CANVAS) {
      const spacing = SPACING;
      const fontSize = 20;
      ctx.fillStyle = "black";
      ctx.font = `${fontSize}px serif`;

      for (let i = 1; i < bassGrid.length; i++) {
        const isMatch = location === bassGrid[i];
        if (isMatch) {
          // Sits just above the highest ledger line, independent of note pitch.
          ctx.fillText(chordName, location - spacing, STAFF_Y_OFFSET - 16);
        }
      }
    }
  }


  function drawTabLines(ctx: CanvasRenderingContext2D) {
    TAB_LINE_Y.forEach((y) => {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(renderWidth, y);
      ctx.stroke();
    });
  }

  function drawTabLabel(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'black';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('T', 20, 62 + STAFF_Y_OFFSET);
    ctx.fillText('A', 20, 75 + STAFF_Y_OFFSET);
    ctx.fillText('B', 20, 88 + STAFF_Y_OFFSET);
    ctx.textAlign = 'left';
  }

  // The note column and string under the mouse in tab view (a click there
  // opens the fret editor), or null.
  function tabCellAtMouse(): { note: NoteLocation, stringIndex: number } | null {
    const x = mouseX(bassGrid);
    const note = bassNoteGrid.find((n) => n.x === x);
    if (!note || Math.abs(MOUSE.x - x) > 18) return null;
    const row = TAB_LINE_Y.findIndex((y) => Math.abs(MOUSE.y - y) <= 8);
    if (row === -1) return null;
    return { note, stringIndex: rowOfString(row) };
  }

  function drawTabNotes(ctx: CanvasRenderingContext2D) {
    const positions = tabPositions(bassNoteGrid);
    bassNoteGrid.forEach((note, k) => {
      const position = positions[k];
      if (!position || !bassGrid.includes(note.x)) return;
      const y = TAB_LINE_Y[rowOfString(position.stringIndex)];

      // Blank out the line under the number so it reads clearly, matching how
      // printed tab renders fret numbers directly on the string.
      ctx.fillStyle = 'white';
      ctx.fillRect(note.x - 8, y - 7, 16, 14);

      ctx.fillStyle = 'black';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(position.fret), note.x, y + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    });

    // Hovered cell: where a click will type a fret.
    const hover = tabCellAtMouse();
    if (hover && !tabEdit) {
      const y = TAB_LINE_Y[rowOfString(hover.stringIndex)];
      ctx.save();
      ctx.strokeStyle = '#4281b2';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hover.note.x - 11, y - 9, 22, 18);
      ctx.restore();
    }
  }

  function drawScene() {
    const CANVAS = canvasRef.current;
    if (CANVAS) {
      // Resizing reallocates the canvas, so only do it when the size changes.
      if (CANVAS.width !== renderWidth) CANVAS.width = renderWidth;
      if (CANVAS.height !== CANVAS_HEIGHT) CANVAS.height = CANVAS_HEIGHT;
      const ctx = CANVAS.getContext('2d');
      const spacing = SPACING;
      if (ctx) {
        ctx.clearRect(0, 0, CANVAS.width, CANVAS.height);
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 1;

        if (viewMode === 'tab') {
          drawTabLines(ctx);
          for (let i = 0; i < measureLines.length; i++){
            ctx.beginPath();
            ctx.moveTo(measureLines[i], STAFF_Y_OFFSET + 45);
            ctx.lineTo(measureLines[i], STAFF_Y_OFFSET + 105);
            ctx.stroke();
          }

          drawTabLabel(ctx);

          drawTabNotes(ctx);
        } else {
          MAIN_LINES_Y.forEach((pitchY) => {
            const y = pitchY + STAFF_Y_OFFSET;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(renderWidth, y);
            ctx.stroke();
          });
          // The extra ledger lines above/below the staff are drawn per-note
          // in drawNote/drawLedgerLines, not as permanent lines here - notes
          // can still be placed on them and in the spaces around them.

          for (let i = 0; i < measureLines.length; i++){
            ctx.beginPath();
            ctx.moveTo(measureLines[i], STAFF_Y_OFFSET + MAIN_LINES_Y[0]);
            ctx.lineTo(measureLines[i], STAFF_Y_OFFSET + MAIN_LINES_Y[MAIN_LINES_Y.length - 1]);
            ctx.stroke();
          }

          const rawIndex = Math.round((MOUSE.y - STAFF_Y_OFFSET) / spacing);
          const index = Math.min(NOTE_MAX_Y / spacing, Math.max(NOTE_MIN_Y / spacing, rawIndex));

          // Centered on the staff's actual middle line (D2), not the canvas's
          // geometric center - the canvas isn't vertically symmetric around
          // the staff since it has 3 ledger lines above but only 1 below.
          drawClef(ctx, { x: 45, y: MAIN_LINES_Y[2] + STAFF_Y_OFFSET, acc:'none' });

          bassNoteGrid.forEach((note) => {
            drawNote(ctx, note);
          });
          if (pendingNote) {
            const note = bassNoteGrid.find((n) => n.x === pendingNote.x && n.y === pendingNote.y);
            if (note) {
              drawAccidentalOptions(ctx, note, spacing);
            }
          }

          const location = {
            x: mouseX(bassGrid),
            y: index * spacing,
            acc: 'none'
          };
          drawNote(ctx, location);
        }

        chordGrid.forEach((chord, i) => {
          displayChord(ctx, chord, bassGrid, chords[i])
        })
      }
    }
  }

  useEffect(() => {
    // Event Listener Setup
    const CANVAS = canvasRef.current;

    function onMouseMove(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
      const CANVAS = canvasRef.current;
      if (CANVAS) {
        const rect = CANVAS.getBoundingClientRect();
        const scrollLeft = document.documentElement.scrollLeft;
        const scrollTop = document.documentElement.scrollTop;
        MOUSE.x = event.clientX - rect.left - scrollLeft;
        MOUSE.y = event.clientY - rect.top - scrollTop;
        requestDraw();
      }
    }

    function onMouseDown(event: MouseEvent) {
      MOUSE.isDown = true;
      // Tab view: click a string at a note to type its fret there. The
      // default mousedown action would move focus off the editor that just
      // opened (the canvas can't take focus), closing it again.
      if (viewMode === 'tab') {
        const cell = tabCellAtMouse();
        if (cell) {
          event.preventDefault();
          openTabEdit(cell.note.x, cell.stringIndex);
        }
        return;
      }
      const CANVAS = canvasRef.current;
      if (CANVAS) {
        const spacing = SPACING;
        const fontSize = 20;

        // Accidental options are currently on display for a note - this click
        // either picks one of the two offered symbols or dismisses them.
        if (pendingNote) {
          const note = bassNoteGrid.find((n) => n.x === pendingNote.x && n.y === pendingNote.y);
          if (note) {
            const hit = getAccidentalOptionLayout(note, spacing, fontSize).find((opt) =>
              MOUSE.x >= opt.x - 10 && MOUSE.x <= opt.x + fontSize &&
              MOUSE.y >= opt.y - fontSize && MOUSE.y <= opt.y + 6
            );
            if (hit) {
              const updatedBassNotes = bassNoteGrid.map((n) =>
                n.x === note.x && n.y === note.y ? { ...n, acc: hit.acc } : n
              );
              dispatch(setBassState({ index: part, bassNoteLocations: updatedBassNotes }));
            }
          }
          setPendingNote(null);
          return;
        }

        const rawIndex = Math.round((MOUSE.y - STAFF_Y_OFFSET) / spacing);
        const index = Math.min(NOTE_MAX_Y / spacing, Math.max(NOTE_MIN_Y / spacing, rawIndex));
        const x = mouseX(bassGrid);

        // A note (not a rest) already sits in the exact cell being clicked -
        // show its two other accidental options instead of repositioning it.
        const clickedNote = bassNoteGrid.find(
          (note) => note.x === x && note.y === index * spacing && isStaffPitch(note.y)
        );

        if (clickedNote) {
          setPendingNote({ x: clickedNote.x, y: clickedNote.y });
        } else {
          const updatedBassNotes = bassNoteGrid.map((note) => {
            if (note.x === x) {
              return { ...note, y: index * spacing };
            }
            return note;
          });

          dispatch(setBassState({ index: part, bassNoteLocations: updatedBassNotes }));
        }
      }
    }

    function onMouseUp(event: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
      MOUSE.isDown = false;
    }

    if (CANVAS) {
      CANVAS.addEventListener('mousemove', onMouseMove as any);
      CANVAS.addEventListener('mousedown', onMouseDown as any);
      CANVAS.addEventListener('mouseup', onMouseUp as any);
    }
    return () => {
      if (CANVAS) {
        CANVAS.removeEventListener('mousemove', onMouseMove as any);
        CANVAS.removeEventListener('mousedown', onMouseDown as any);
        CANVAS.removeEventListener('mouseup', onMouseUp as any);
      }
    };
    // Re-bound only when something the handlers read changes - not on every
    // playback step.
  }, [MOUSE, viewMode, pendingNote, bassNoteGrid, bassGrid, part, dispatch, requestDraw, tabEdit]);

  // ---- Tab fret editor -----------------------------------------------------

  // Open the editor on a note's column and string, showing the note's fret
  // if it's played on that string.
  function openTabEdit(x: number, stringIndex: number) {
    const k = bassNoteGrid.findIndex((n) => n.x === x);
    if (k === -1) return;
    const position = tabPositions(bassNoteGrid)[k];
    const value = position && position.stringIndex === stringIndex ? String(position.fret) : '';
    skipBlurCommit.current = false;
    setTabEdit({ x, stringIndex, value });
    setPendingNote(null);
  }

  // Apply what was typed: a fret number moves the note to that string and
  // fret (re-spelled on the staff for the key); empty or "x" on the note's
  // own string turns it into a rest. Anything else leaves it as it was.
  function commitTabEdit(edit: { x: number, stringIndex: number, value: string }) {
    const k = bassNoteGrid.findIndex((n) => n.x === edit.x);
    if (k === -1) return;
    const note = bassNoteGrid[k];
    const text = edit.value.trim().toLowerCase();
    const current = tabPositions(bassNoteGrid)[k];
    let updated: NoteLocation | null = null;
    if (text === '' || text === 'x' || text === '-') {
      if (current && current.stringIndex === edit.stringIndex) {
        updated = { ...note, y: -20, acc: 'none', string: undefined };
      }
    } else if (/^\d{1,2}$/.test(text) && Number(text) <= MAX_FRET) {
      const fret = Number(text);
      if (current && current.stringIndex === edit.stringIndex && current.fret === fret && note.string === edit.stringIndex) return;
      const midi = BASS_OPEN_MIDI[edit.stringIndex] + fret;
      const key = parseKeyString(song.key) ?? { tonic: 0, mode: 'major' as const };
      const spelled = spellPc(midi, key);
      const acc = spelled.acc > 0 ? 'sharp' : spelled.acc < 0 ? 'flat' : 'none';
      updated = { ...note, y: staffY(midi, spelled), acc, string: edit.stringIndex };
    }
    if (updated) {
      dispatch(setBassState({ index: part, bassNoteLocations: bassNoteGrid.map((n, i) => (i === k ? updated! : n)) }));
    }
  }

  function handleTabKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!tabEdit) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      skipBlurCommit.current = true;
      commitTabEdit(tabEdit);
      setTabEdit(null);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      skipBlurCommit.current = true;
      setTabEdit(null);
    } else if (event.key === 'Tab') {
      // Commit and move along the same string to the next (or previous) note.
      event.preventDefault();
      skipBlurCommit.current = true;
      commitTabEdit(tabEdit);
      const columns = bassNoteGrid.map((n) => n.x).filter((x) => bassGrid.includes(x)).sort((a, b) => a - b);
      const next = columns[columns.indexOf(tabEdit.x) + (event.shiftKey ? -1 : 1)];
      if (next !== undefined) {
        // Opened after the edit lands, reading the updated notes.
        setTimeout(() => openTabEditRef.current(next, tabEdit.stringIndex));
      } else {
        setTabEdit(null);
      }
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const n = Number(tabEdit.value);
      const base = tabEdit.value === '' || Number.isNaN(n) ? 0 : n;
      const value = Math.min(MAX_FRET, Math.max(0, base + (event.key === 'ArrowUp' ? 1 : -1)));
      setTabEdit({ ...tabEdit, value: String(value) });
    }
  }

  const openTabEditRef = useRef(openTabEdit);
  openTabEditRef.current = openTabEdit;

  const [isPlaying, setIsPlaying] = React.useState(false);
  const stopRef = useRef(false);

  const handleStartClick = async () => {
    if (isPlaying) {
      stopRef.current = true;
      setIsPlaying(false);
      onPlayingChange?.(false);
      return;
    }
    stopRef.current = false;
    setIsPlaying(true);
    onPlayingChange?.(true);
    const endBeat = await playBass(midi, beat, bassNoteGrid, bassGroove, bpm, () => stopRef.current, handleStep, drumGroove, undefined, acoustic);
    setIsPlaying(false);
    onPlayingChange?.(false);
    const nextBeat = endBeat >= bassGroove.length ? 0 : endBeat;
    dispatch(setCurrentBeat([part, song.selectedBeat[1], nextBeat, song.selectedBeat[3]]));
  };

  useImperativeHandle(ref, () => ({
    play: handleStartClick
  }));

  drawRef.current = drawScene;

  // Draw when what the staff shows changes, and once the clef image loads.
  useEffect(() => {
    requestDraw();
  }, [requestDraw, renderWidth, bassNoteGrid, bassGroove, chords, chordGrid, bassGrid, measureLines, pendingNote, viewMode, tabEdit]);

  useEffect(() => {
    if (!CLEF_IMAGE.complete) CLEF_IMAGE.addEventListener('load', requestDraw);
    return () => {
      CLEF_IMAGE.removeEventListener('load', requestDraw);
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
    };
  }, [requestDraw]);

  return (
    // Sticky positioning can only carry the button as far as this container's
    // own box extends. Left unset, the div shrinks to the visible viewport
    // width (the canvas merely overflows it visually), so the button would
    // stop sticking a screen-width into the scroll. Matching the canvas's
    // actual rendered width here gives it room to stick the whole way.
    <div style={{ width: renderWidth || '100%', position: 'relative' }}>
      <button
        type="button"
        onClick={() => onViewModeChange(viewMode === 'staff' ? 'tab' : 'staff')}
        className={viewMode === 'tab' ? `${appStyles.button} ${appStyles.openButton} ${appStyles.stickyToggle}` : `${appStyles.button} ${appStyles.stickyToggle}`}
      >
        {viewMode === 'staff' ? 'Staff' : 'Tab'}
      </button>
      <canvas ref={canvasRef} id="myCanvas" />
      {viewMode === 'tab' && tabEdit && (
        <input
          key={`${tabEdit.x}:${tabEdit.stringIndex}`}
          className={appStyles.tabInput}
          style={{
            left: tabEdit.x - 15,
            top: (canvasRef.current?.offsetTop ?? 0) + TAB_LINE_Y[rowOfString(tabEdit.stringIndex)] - 12,
          }}
          value={tabEdit.value}
          autoFocus
          inputMode="numeric"
          maxLength={2}
          aria-label="Fret number"
          title="Fret 0-20 · Enter to set · Tab for the next note · ↑↓ to step · x or empty to make a rest · Esc to cancel"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setTabEdit({ ...tabEdit, value: e.target.value.replace(/[^0-9xX-]/g, '') })}
          onKeyDown={handleTabKey}
          onBlur={() => {
            if (!skipBlurCommit.current) commitTabEdit(tabEdit);
            skipBlurCommit.current = false;
            // Clicking another cell opens its editor before this one blurs;
            // close only if this edit is still the open one.
            setTabEdit((open) => (open === tabEdit ? null : open));
          }}
        />
      )}
    </div>
  )
});

export default BassStaff;