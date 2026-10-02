import { useEffect, useMemo, useRef } from "react";
import { suggestPalette, paletteText, presetLibraryText, presetName, samePick, saveStep, PaletteInput, RolePick, SoundPick, ROLE_TITLES } from "../Core/timbre";
import styles from "../Styles/App.module.scss";

interface SoundsProps {
  input: PaletteInput;
  // The combination saved with the song (null = the best match).
  choice: SoundPick | null;
  onChoose: (choice: SoundPick | null) => void;
  // Base name shared with the MIDI export, so the sheet sits next to the .mid.
  filename: string;
  title: string;
  onClose: () => void;
}

function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SoundCard({ pick, heading, drumMap }: { pick: RolePick; heading?: string; drumMap?: string }) {
  const tb = pick.timbre;
  return (
    <div className={styles.soundCard}>
      <div className={styles.soundRole}>{heading ?? ROLE_TITLES[pick.role]}</div>
      <div className={styles.soundName}>{tb.name}</div>
      <div className={styles.soundMeta}>
        <b>{tb.device}</b>
        <span title="Search Live's Browser for this name once you've saved the sound">Saved preset: {presetName(tb)}</span>
      </div>
      <p className={styles.soundTip}>{tb.basis}</p>
      <ul className={styles.soundWhy}>
        {pick.why.map(w => <li key={w}>{w}</li>)}
      </ul>
      <div className={styles.soundRole}>Starting patch</div>
      <ol className={styles.soundWhy}>
        {tb.setup.map(step => <li key={step}>{step}</li>)}
        <li>{saveStep(tb)}</li>
      </ol>
      {drumMap && <p className={styles.soundTip}>Pads the .mid plays: {drumMap}</p>}
    </div>
  );
}

// Suggested Live 10 Suite instruments for the current song (see timbre.ts).
export default function Sounds({ input, choice, onChoose, filename, title, onClose }: SoundsProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const palette = useMemo(() => suggestPalette(input, choice), [input, choice]);
  // A saved choice that edits have moved the song away from.
  const stale = choice !== null && !samePick(choice, palette.pick);
  const showSections = palette.sections.some(sec => sec.moves.length > 0);
  const showEnergy = palette.sections.some(sec => sec.energy !== null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const next = () => {
    const variant = (palette.variant + 1) % palette.variants;
    onChoose(variant === 0 ? null : suggestPalette(input, variant).pick);
  };

  return (
    <div className={styles.generateContainer} ref={ref}>
      <button onClick={onClose}>x</button>
      <h2>Sounds for Ableton Live 10 Suite</h2>
      <p>
        <b>{palette.style.name}</b> · {palette.summary}
      </p>
      <p className={styles.soundNote}>
        Recommended from what each Live 10 Suite instrument is built to do, to suit this song's tempo, chords,
        bass and drums. Load the exported .mid into Live, then set these up on its tracks. The .mid plays strong
        beats and high-energy sections louder, so velocity-sensitive patches respond. Save each sound once under
        its preset name and it's one Browser search away next time. Choosing sounds never changes a note, and
        your choice is saved with the song.
      </p>
      {stale && (
        <p className={styles.soundNote}>
          The combination chosen earlier no longer fits this song after its edits, so this is the best match again.
        </p>
      )}
      <div className={styles.soundGrid}>
        <SoundCard pick={palette.drums} drumMap={palette.drumMap} />
        <SoundCard pick={palette.bass} />
        <SoundCard pick={palette.chords} />
        {palette.guide && <SoundCard pick={palette.guide} />}
      </div>
      {showSections && (
        <>
          <h3>Section by section</h3>
          <table className={styles.soundSections}>
            <thead>
              <tr>
                <th>Section</th>
                {showEnergy && <th>Energy</th>}
                <th>Chord sound</th>
                <th>Changes</th>
              </tr>
            </thead>
            <tbody>
              {palette.sections.map(sec => (
                <tr key={sec.label}>
                  <td>{sec.label}</td>
                  {showEnergy && <td>{sec.energy === null ? '–' : `${Math.round(sec.energy * 100)}%`}</td>}
                  <td>{sec.chords.name}</td>
                  <td>{sec.moves.length ? sec.moves.map(m => <div key={m}>{m}</div>) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {palette.extraChords.length > 0 && (
            <div className={styles.soundGrid}>
              {palette.extraChords.map(x => <SoundCard key={x.timbre.name} pick={x} heading="Chords, some sections" />)}
            </div>
          )}
        </>
      )}
      <h3>How they fit together</h3>
      <ul className={styles.soundWhy}>
        {palette.interplay.map(n => <li key={n}>{n}</li>)}
      </ul>
      <div className={styles.soundActions}>
        <button onClick={next} title="Step through the other good combinations for this song">
          Another combination ({palette.variant + 1}/{palette.variants})
        </button>
        {palette.variant > 0 && <button onClick={() => onChoose(null)}>Best match</button>}
        <button onClick={() => downloadText(paletteText(palette, title), `${filename}-sounds.txt`)}>
          Download sound sheet
        </button>
        <button onClick={() => downloadText(presetLibraryText(), 'live10-preset-build-list.txt')}
          title="Every sound in the table, to build once and save to your User Library">
          Download preset build list
        </button>
      </div>
    </div>
  );
}
