import { useCallback, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { SongState, rerollLayer, toggleLock, setPartEnergy, setLoop, editHarmony } from "../reducers";
import ChordMenu, { ChordMenuKind } from "./ChordMenu";
import { inversionOptions } from "../Core/chordOptions";
import { isDetached } from "../Core/generate";
import { clampRegion, comparePoints, sum } from "../Playback/loop";
import { Layer, LAYERS, LAYER_DEPENDENTS } from "../Core/doc";
import { spellInChord, spellPc, spelledName } from "../Core/theory";
import { transposedKey } from "../Core/realize";
import styles from "../Styles/App.module.scss";

interface SectionPanelProps {
  part: number;
}

const LAYER_INFO: Record<Layer, { label: string; hint: string }> = {
  harmony: { label: "Harmony", hint: "Chord progression and cadence. Re-rolling also re-voices chords and rewrites the bass unless those are locked." },
  rhythm: { label: "Rhythm", hint: "Bass rhythm and the drum step grid. Re-rolling rebuilds bass notes and drums unless locked (locked ones are kept on the new grid)." },
  bass: { label: "Bass", hint: "Bass pitches over the current rhythm and chords." },
  drums: { label: "Drums", hint: "The section's groove. Crashes and fills at transitions are added per instance." },
  voicing: { label: "Voicing", hint: "Chord voicings (voice-led from chord to chord)." },
};

// Controls for the section an open part plays: its progression, the layer
// locks and re-roll buttons, and this instance's energy. Everything except
// energy acts on the section definition, i.e. every instance at once.
export default function SectionPanel({ part }: SectionPanelProps) {
  const dispatch = useDispatch();
  const song = useSelector((state: { song: SongState }) => state.song);
  // Which chord cell's menu is open, and which menu.
  const [menu, setMenu] = useState<{ chord: number, kind: ChordMenuKind } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const doc = song.doc;
  const p = song.songStructure[part];
  if (!doc || !p?.sectionId || !doc.sections[p.sectionId]) return null;
  const section = doc.sections[p.sectionId];
  const instance = doc.form[part];
  const plays = doc.form.filter(f => f.sectionId === section.id).length;
  const key = transposedKey(doc.key, instance?.transpose ?? 0);
  const whole = { start: { part, beat: 0 }, end: { part, beat: sum(p.drumGroove) } };
  const loop = clampRegion(song.loop, song.songStructure);
  const loopingThis = !!song.loopEnabled && !!loop && comparePoints(loop.start, whole.start) === 0 && comparePoints(loop.end, whole.end) === 0;

  return (
    <div className={styles.sectionPanel}>
      <div className={styles.sectionHeader}>
        <strong>{section.label}</strong>
        <span>{section.bars} bars · {section.cadence} cadence · plays {plays}×{instance?.transpose ? ` · lifted +${instance.transpose}` : ""}</span>
        <button
          className={loopingThis ? `${styles.rerollButton} ${styles.loopingSection}` : styles.rerollButton}
          onClick={() => dispatch(setLoop(loopingThis ? null : whole))}
          title="Cycle playback over this section - handy while re-rolling its layers"
        >
          {loopingThis ? "⟳ Looping" : "⟳ Loop section"}
        </button>
        <label className={styles.energyControl} title="Energy of this instance only: shapes hats, kick, and the transitions around it.">
          Energy
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={instance?.energy ?? section.energy}
            onChange={(e) => dispatch(setPartEnergy({ index: part, energy: parseFloat(e.target.value) }))}
          />
        </label>
      </div>
      <div className={styles.progression}>
        {p.chords.map((chord, i) => {
          const event = section.harmony[i];
          const toggle = (kind: ChordMenuKind) => setMenu(menu?.chord === i && menu.kind === kind ? null : { chord: i, kind });
          const bass = event ? inversionOptions(event, key)[Math.min(event.inversion, inversionOptions(event, key).length - 1)]?.bass : '';
          return (
            <span key={i} className={styles.chordCell} style={{ flexGrow: p.chordsGroove[i] }}>
              <button className={styles.chordSymbol} onClick={() => toggle('chord')} title="Change to any chord">{chord}</button>
              <button className={styles.chordRoman} onClick={() => toggle('roman')} title="Alternatives for this chord">{p.roman?.[i]}</button>
              <button className={styles.chordBass} onClick={() => toggle('bass')} title="Bass note: inversions">bass {bass}</button>
              {p.guideTones?.[i] ? (
                <span className={styles.guideTone} title="Guide tone (3rd/7th)">guide {spelledName(event ? spellInChord(p.guideTones[i], event, key) : spellPc(p.guideTones[i], key))}</span>
              ) : null}
              {menu?.chord === i && event && (
                <ChordMenu
                  kind={menu.kind}
                  chord={event}
                  chordKey={key}
                  alignRight={i >= p.chords.length / 2}
                  onPick={(change) => dispatch(editHarmony({ part, chord: i, change }))}
                  onClose={closeMenu}
                />
              )}
            </span>
          );
        })}
      </div>
      <div className={styles.layerRow}>
        {LAYERS.map(layer => {
          const locked = section.locks[layer];
          const dependents = LAYER_DEPENDENTS[layer].filter(d => !section.locks[d]);
          return (
            <span key={layer} className={styles.layerControl} title={LAYER_INFO[layer].hint}>
              <button
                className={locked ? `${styles.lockButton} ${styles.locked}` : styles.lockButton}
                onClick={() => dispatch(toggleLock({ sectionId: section.id, layer, part }))}
                aria-pressed={locked}
                title={locked ? "Locked: re-rolls won't change this layer. Click to unlock." : "Click to lock this layer."}
              >
                {locked ? "🔒" : "🔓"}
              </button>
              <button
                className={styles.rerollButton}
                disabled={locked}
                onClick={() => dispatch(rerollLayer({ sectionId: section.id, layer, part }))}
              >
                Re-roll {LAYER_INFO[layer].label}
              </button>
              {!locked && dependents.length > 0 && (
                <span className={styles.layerNote}>+ {dependents.join(", ")}</span>
              )}
            </span>
          );
        })}
      </div>
      <p className={styles.sectionNote}>
        Click a chord, its numeral or its bass note to change it. {isDetached(doc, part)
          ? <>This part is detached: edits and re-rolls change only it, and lock that layer. Switch to All linked to copy its state to every linked {section.label.toLowerCase()}.</>
          : <>Edits here apply to every {section.label.toLowerCase()}{plays > 1 ? ` (${plays} parts)` : ''} and lock that layer.</>} Drum edits inside a fill or crash stay on this instance.
      </p>
    </div>
  );
}
