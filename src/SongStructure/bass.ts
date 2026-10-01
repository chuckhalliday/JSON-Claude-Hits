import { rng } from "./rng";
import { bassPitch } from "./bassPitch";
import { NoteLocation } from "../types";
import { bassTonalityOdds } from "./tuning";

//calculates an array of x-coordinates where the measure lines should be drawn on bass staff canvas
export function bassMeasures(bassGroove: number[], drumGroove: number[]) {
  let bassArray: number[]=[-10, 115]
  let gridX: number = 115
  let bassSum: number = bassGroove[0]
  let drumSum: number = 0
  let bassIndex: number = 1
  let measureLines: number[] = []
  for (let i = 0; i < drumGroove.length; i++) {
    drumSum+= drumGroove[i]
    if (drumSum >= 3.93 && drumSum <= 4.07 || drumSum >= 7.93 && drumSum <= 8.07) {
      gridX += 78
      measureLines.push(gridX - 42)
    } else if (Math.abs(Math.round(drumSum) - drumSum) <= 0.005) {
      gridX += 48
    } else {
      gridX += 38
    }
    if (bassSum - drumSum <= 0.05) {
      bassArray.push(gridX)
    if (bassSum >= 7.95 && drumSum >= 7.95) {
      bassSum = 0
      drumSum = 0
    }
    bassSum += bassGroove[bassIndex]
    bassIndex++
    }
  }
  return [bassArray, measureLines]
}

const dVals = ["o", "a", "c", "f"];
const eVals = ["p", "d", "g", "b"];
const fVals = ["o", "a", "c", "e"];
const gVals = ["o", "p", "b", "d", "f"];
const cVals = ["e", "g", "p", "b"];
const aVals = ["c", "e", "g", "p"];
const GVals = ["e", "d", "a"];
const bVals = ["e", "g", "p", "b"];

// These accidental choices used to be rolled once at module load off
// rng(), before any seed existed. They are now (re)rolled from the
// seeded RNG at the start of song generation (see rollAccidentals), so a given
// seed reproduces them. Fixed defaults keep importing this module side-effect free.
let dAcc = dVals[0];
let eAcc = eVals[0];
let fAcc = fVals[0];
let gAcc = gVals[0];
let cAcc = cVals[0];
let aAcc = aVals[0];
let GAcc = GVals[0];
let bAcc = bVals[0];

export function rollAccidentals(): void {
  dAcc = dVals[Math.floor(rng() * dVals.length)];
  eAcc = eVals[Math.floor(rng() * eVals.length)];
  fAcc = fVals[Math.floor(rng() * fVals.length)];
  gAcc = gVals[Math.floor(rng() * gVals.length)];
  cAcc = cVals[Math.floor(rng() * cVals.length)];
  aAcc = aVals[Math.floor(rng() * aVals.length)];
  GAcc = GVals[Math.floor(rng() * GVals.length)];
  bAcc = bVals[Math.floor(rng() * bVals.length)];
}


export function bassArray1V(bassGroove: number[], tonality?: string) {
  let a_c: string
  if (tonality === 'Major') {
    a_c = "c"
  } else if (tonality === 'Minor') {
    a_c = "a"
  } else {
    // Stock 50/50 major/minor split when the menu left tonality to chance,
    // scaled by the Advanced panel's Bass Tonality dial.
    a_c = rng() < bassTonalityOdds(0.5) ? "a" : "c";
  }
  let bass: string[] = [a_c];

  let possibleBassValues: string[];
  if (a_c === "c") {
    possibleBassValues = ["c", "e", "b", "g", "A"];
  } else if (a_c === "a") {
    possibleBassValues = ["a", "c", "e", "g", "G"];
  } else {
    possibleBassValues = ["c", "e", "g"]
  }

  let acc1 = possibleBassValues[Math.floor(rng() * possibleBassValues.length)];
  let acc2 = possibleBassValues[Math.floor(rng() * possibleBassValues.length)];

  for (let i = 1; i < bassGroove.length; i++) {
    if (bassGroove[i] <= 0.25) {
      bass.push("-");
    } else {
      bass.push(rng() < 0.5 ? a_c : (rng() < 0.5 ? acc1 : acc2));
    }
  }
  return bass;
}

export function bassArray2V(bassGroove: number[], bassLine1V: string[]) {
  let bass: string[] = [];
  let sum = 0;
  let possibleBassValues;

  if (bassLine1V[0] === 'c') {
    possibleBassValues = ["f", "g"];
  } else if (bassLine1V[0] === "a") {
    possibleBassValues = ["d", "e"];
  } else {
    possibleBassValues = ["a", "c"]
  }


  let bass2 = possibleBassValues[Math.floor(rng() * possibleBassValues.length)];

  let acc;

  if (bass2 === "d") {
    acc = dAcc;
  } else if (bass2 === "e") {
    acc = eAcc;
  } else if (bass2 === "f") {
    acc = fAcc;
  } else if (bass2 === "g") {
    acc = gAcc;
  } else {
    acc = "c"
  }

  for (let i = 0; i < bassGroove.length; i++) {
    if (bassGroove[i] <= 0.25) {
      bass.push("-");
    } else if (sum <= 2 || (sum > 4 && sum <= 6)) {
      bass.push(bass2);
    } else {
      bass.push(rng() < 0.3 ? bass2 : acc);
    }
    sum += bassGroove[i];
  }
  return bass;
}

export function bassArray3V(bassGroove: number[], bassLine2V: string[]) {
  let bass: string[] = [];
  let sum = 0;
  let possibleBassValues = ["d", "e", "f", "g", "b"];

  if (bassLine2V[0] === "f" || bassLine2V[0] === "g") {
    possibleBassValues = ["a", "d", "e"];
  } else if (bassLine2V[0] === "d" || bassLine2V[0] === "e") {
    possibleBassValues = ["c", "f", "g"];
  } 

  let bass3 = possibleBassValues[Math.floor(rng() * possibleBassValues.length)];

  let acc: string;
  if (bass3 === "d") {
    acc = dAcc;
  } else if (bass3 === "e") {
    acc = eAcc;
  } else if (bass3 === "f") {
    acc = fAcc;
  } else if (bass3 === "g") {
    acc = gAcc;
  } else if (bass3 === "c") {
    acc = cAcc;
  } else if (bass3 === "a") {
    acc = aAcc;
  } else {
    acc = "c"
  }


  for (let i = 0; i < bassGroove.length; i++) {
    if (bassGroove[i] <= 0.25) {
      bass.push("-");
    } else if (sum <= 2 || (sum > 4 && sum <= 6)) {
      bass.push(bass3);
    } else {
      bass.push(rng() < 0.3 ? bass3 : acc);
    }
    sum += bassGroove[i];
  }
  return bass;
}

export function bassArray4V(bassGroove: number[], bassLine1V:string[]) {
  let bass: string[] = [];
  let sum = 0;
  let possibleBassValues = ["d", "e", "f", "g", "b"];
  if (bassLine1V[0] === "c") {
    possibleBassValues = ["b", "g"];
  } else if (bassLine1V[0] === "a") {
    possibleBassValues = ["e", "g"];
  }

  let bass4 = possibleBassValues[Math.floor(rng() * possibleBassValues.length)];


  let acc;
    if (bass4 === "e") {
    acc = eAcc;
  } else if (bass4 === "g") {
    acc = gAcc;
  } else if (bass4 === "b") {
    acc = bAcc;
  } else {
    acc = "c"
  }

  for (let i = 0; i < bassGroove.length; i++) {
    if (bassGroove[i] <= 0.25) {
      bass.push("-");
    } else {
      if (sum >= 0 && sum <= 2 || sum >= 7) {
        bass.push(bass4);
      } else {
        bass.push(rng() < 0.6 ? bass4 : acc);
      }
    }
    sum += bassGroove[i];
  }
  return bass;
}

export function bassArray1C(bassGroove: number[], bassLine1V: string[]) {
  let bass: string[] = [];
  let sum = 0;
  let possibleBassValues = ["d", "e", "f", "g", "b"];

  if (bassLine1V[0] === 'c') {
    possibleBassValues = ["f", "g"];
  } else if (bassLine1V[0] === "a") {
    possibleBassValues = ["d", "e"];
  }
  let bass1 = possibleBassValues[Math.floor(rng() * possibleBassValues.length)];

  let acc;

  if (bass1 === "d") {
    acc = dAcc;
  } else if (bass1 === "e") {
    acc = eAcc;
  } else if (bass1 === "f") {
    acc = fAcc;
  } else if (bass1 === "g") {
    acc = gAcc;
  } else {
    acc = "c"
  }

  for (let i = 0; i < bassGroove.length; i++) {
    if (bassGroove[i] <= 0.25) {
      bass.push("-");
    } else if (sum <= 2 || (sum > 4 && sum <= 6)) {
      bass.push(bass1);
    } else {
      bass.push(rng() < 0.3 ? bass1 : acc);
    }
    sum += bassGroove[i];
  }
  return bass;
}

export function bassArray2C(bassGroove: number[], bassLine1C: string[]) {
  let bass: string[] = [];
  let sum = 0;
  let possibleBassValues = ["d", "e", "f", "g", "b"];

  if (bassLine1C[0] === "f" || bassLine1C[0] === "g") {
    possibleBassValues = ["a", "d", "e"];
  } else if (bassLine1C[0] === "d" || bassLine1C[0] === "e") {
    possibleBassValues = ["c", "f", "g"];
  } 

  let bass2 = possibleBassValues[Math.floor(rng() * possibleBassValues.length)];

  let acc;
  if (bass2 === "d") {
    acc = dAcc;
  } else if (bass2 === "e") {
    acc = eAcc;
  } else if (bass2 === "f") {
    acc = fAcc;
  } else if (bass2 === "g") {
    acc = gAcc;
  } else if (bass2 === "c") {
    acc = cAcc;
  } else if (bass2 === "a") {
    acc = aAcc;
  } else {
    acc = "c"
  }

  for (let i = 0; i < bassGroove.length; i++) {
    if (bassGroove[i] <= 0.25) {
      bass.push("-");
    } else if (sum <= 2 || (sum >= 4 && sum < 6)) {
      bass.push(bass2);
    } else {
      bass.push(rng() < 0.3 ? bass2 : acc);
    }
    sum += bassGroove[i];
  }
  return bass;
}

export function bassArray3C(bassGroove: number[], bassLine1V: string[]) {
  let bass: string[] = [];
  let sum = 0;

  let possibleBassValues;
  if (bassLine1V[0] === "c") {
    possibleBassValues = ["c", "e", "b", "g", "A"];
  } else if (bassLine1V[0] === "a") {
    possibleBassValues = ["a", "c", "e", "g", "G"];
  } else {
    possibleBassValues = ["c", "e", "g"]
  }

  let bass3 = bassLine1V[0]
  let acc1 = possibleBassValues[Math.floor(rng() * possibleBassValues.length)];
  let acc2 = possibleBassValues[Math.floor(rng() * possibleBassValues.length)];

  for (let i = 0; i < bassGroove.length; i++) {
    if (bassGroove[i] <= 0.25) {
      bass.push("-");
    } else if (sum <= 2 || (sum >= 4 && sum < 6)) {
        bass.push(bass3)
    } else {
        bass.push(rng() < 0.4 ? acc1 : acc2);
    }
    sum += bassGroove[i];
  }
  return bass;
}

export function bassArray4C(bassGroove: number[], bassLine1V: string[]) {
  let bass: string[] = [];
  let sum = 0;
  let possibleBassValues = ["d", "e", "f", "g", "b"];
  if (bassLine1V[0] === "c") {
    possibleBassValues = ["b", "g"];
  } else if (bassLine1V[0] === "a") {
    possibleBassValues = ["e", "g"];
  }

  let bass4 = possibleBassValues[Math.floor(rng() * possibleBassValues.length)];


  let acc;
    if (bass4 === "e") {
    acc = eAcc;
  } else if (bass4 === "g") {
    acc = gAcc;
  } else if (bass4 === "G") {
    acc = GAcc;
  } else if (bass4 === "b") {
    acc = bAcc;
  } else {
    acc = "c"
  }

  for (let i = 0; i < bassGroove.length; i++) {
    if (bassGroove[i] <= 0.25) {
      bass.push("-");
    } else if (sum >= 0 && sum <= 2 || sum >= 7) {
        bass.push(bass4);
      } else {
        bass.push(rng() < 0.6 ? bass4 : acc);
      }
    sum += bassGroove[i];
  }
  return bass;
}

export function bassArray1B(bassGroove: number[], bassLine1C: string[]) {
  let bass: string[] = [];
  let sum = 0;
  let bass1;

  if (bassLine1C[0] === "f") {
    bass1 = "g";
  } else if (bassLine1C[0] === "g") {
    bass1 = "f";
  } else if (bassLine1C[0] === "d") {
    bass1 = "e";
  } else if (bassLine1C[0] === "e") {
    bass1 = "d";
  } else {
    bass1 = "a"
  }

  let acc;

  if (bass1 === "d") {
    acc = dAcc;
  } else if (bass1 === "e") {
    acc = eAcc;
  } else if (bass1 === "f") {
    acc = fAcc;
  } else if (bass1 === "g") {
    acc = gAcc;
  } else {
    acc = "c"
  }

  for (let i = 0; i < bassGroove.length; i++) {
    if (bassGroove[i] <= 0.25) {
      bass.push("-");
    } else if (sum <= 2 || (sum > 4 && sum <= 6)) {
      bass.push(bass1);
    } else {
      bass.push(rng() < 0.3 ? bass1 : acc);
    }
    sum += bassGroove[i];
  }
  return bass;
}

export function transposeBassArray(bassString: string[], keyAdjust: number) {
  let transpose: string[] = [];
  let keys: string[] = []
  for (let i = 0; i < bassString.length; i++) {
    const sharpKeys = [-10, -8, -6, -5, -3, -1, 0, 2, 4, 6, 7, 9, 11];
    const flatKeys = [-12, -11, -9, -7, -4, -2, 1, 3, 5, 8, 10, 12]
    if (sharpKeys.includes(keyAdjust)) {
    keys = [
      "A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", 
      "A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", 
      "A", "A#", "B", "C", "C#", "D"
    ];
  } else if (flatKeys.includes(keyAdjust)) {
    keys = [
      "A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", 
      "A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", 
      "A", "Bb", "B", "C", "Db", "D"
    ];
  }

    switch (bassString[i]) {
      case "a": transpose.push(keys[12 + keyAdjust]);
        break;
      case "A": transpose.push(keys[13 + keyAdjust]);
        break;
      case "b": transpose.push(keys[14 + keyAdjust]);
        break;
      case "c": transpose.push(keys[15 + keyAdjust]);
        break;
      case "C": transpose.push(keys[16 + keyAdjust]);
        break;
      case "d": transpose.push(keys[17 + keyAdjust]);
        break;
      case "D": transpose.push(keys[18 + keyAdjust]);
        break;
      case "e": transpose.push(keys[19 + keyAdjust]);
        break;
      case "f": transpose.push(keys[20 + keyAdjust]);
        break;
      case "F": transpose.push(keys[21 + keyAdjust]);
        break;
      case "g": transpose.push(keys[22 + keyAdjust]);
        break;
      case "G": transpose.push(keys[23 + keyAdjust]);
        break;
      case "o": transpose.push(keys[20 + keyAdjust]);
        break;
      case "O": transpose.push(keys[21 + keyAdjust]);
        break;
      case "p": transpose.push(keys[22 + keyAdjust]);
        break;
      case "P": transpose.push(keys[23 + keyAdjust]);
        break;
      case "-": transpose.push("-");
        break;
      case "|": transpose.push("|");
        break;
      case " ": transpose.push(" ");
        break;
    }
  }
  return transpose;
}

export function drawBass(bass: string[], bassGrid: number[]) {
  let bassNoteLocations: NoteLocation[] = [];

  for (let i = 1; i < bassGrid.length; i++) {
    let noteLocation: NoteLocation = { x: 0, y: 0, acc: 'none', osc: 0, midi: 0 } // Create a new object for each iteration
  
      noteLocation.x = bassGrid[i];
      // Each grid slot draws the previous bass entry (the grid carries a
      // leading clef offset). The staff line comes from the note's letter and
      // the accidental from its suffix, both read from the same entry.
      const name = bass[i - 1] ?? '';
      const staffY: { [letter: string]: number } = {
        G: 52.5, F: 60, E: 67.5, D: 75, C: 82.5, B: 90, A: 97.5,
      };
      noteLocation.y = staffY[name.charAt(0)] ?? -20;
      if (name.length === 2 && name.charAt(1) === '#') {
        noteLocation.acc = 'sharp';
      } else if (name.length === 2 && name.charAt(1) === 'b') {
        noteLocation.acc = 'flat';
      } else {
        noteLocation.acc = 'none'
      }

      // Store the note's concrete pitch alongside its staff position, computed
      // from the same (y, acc) the staff draws. Playback reads osc/midi and
      // never has to interpret pixels.
      const pitch = bassPitch(noteLocation.y, noteLocation.acc);
      noteLocation.osc = pitch.osc;
      noteLocation.midi = pitch.midi;

      bassNoteLocations.push(noteLocation);
    }

    return bassNoteLocations;
  }
