import { useEffect, useMemo, useRef } from "react";
import { suggestPalette, paletteText, PaletteInput, RolePick, ROLE_TITLES } from "../Core/timbre";
import styles from "../Styles/App.module.scss";

interface SoundsProps {
  input: PaletteInput;
  variant: number;
  onVariant: (variant: number) => void;
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

function SoundCard({ pick, drumMap }: { pick: RolePick; drumMap?: string }) {
  const tb = pick.timbre;
  return (
    <div className={styles.soundCard}>
      <div className={styles.soundRole}>{ROLE_TITLES[pick.role]}</div>
      <div className={styles.soundName}>{tb.name}</div>
      <div className={styles.soundMeta}><b>{tb.device}</b></div>
      <p className={styles.soundTip}>{tb.basis}</p>
      <ul className={styles.soundWhy}>
        {pick.why.map(w => <li key={w}>{w}</li>)}
      </ul>
      <div className={styles.soundRole}>Starting patch</div>
      <ol className={styles.soundWhy}>
        {tb.setup.map(step => <li key={step}>{step}</li>)}
      </ol>
      {drumMap && <p className={styles.soundTip}>Pads the .mid plays: {drumMap}</p>}
    </div>
  );
}

// Suggested Live 10 Suite instruments for the current song (see timbre.ts).
export default function Sounds({ input, variant, onVariant, filename, title, onClose }: SoundsProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const palette = useMemo(() => suggestPalette(input, variant), [input, variant]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div className={styles.generateContainer} ref={ref}>
      <button onClick={onClose}>x</button>
      <h2>Sounds for Ableton Live 10 Suite</h2>
      <p>
        <b>{palette.style.name}</b> · {palette.summary}
      </p>
      <p className={styles.soundNote}>
        Recommended from what each Live 10 Suite instrument is built to do, to suit this song's tempo, chords,
        bass and drums. Load the exported .mid into Live, then set these up on its tracks. Choosing them never
        changes a note.
      </p>
      <div className={styles.soundGrid}>
        <SoundCard pick={palette.drums} drumMap={palette.drumMap} />
        <SoundCard pick={palette.bass} />
        <SoundCard pick={palette.chords} />
      </div>
      <h3>How they fit together</h3>
      <ul className={styles.soundWhy}>
        {palette.interplay.map(n => <li key={n}>{n}</li>)}
      </ul>
      <div className={styles.soundActions}>
        <button onClick={() => onVariant(palette.variant + 1)} title="Step through the other good combinations for this song">
          Another combination ({palette.variant + 1}/{palette.variants})
        </button>
        {palette.variant > 0 && <button onClick={() => onVariant(0)}>Best match</button>}
        <button onClick={() => downloadText(paletteText(palette, title), `${filename}-sounds.txt`)}>
          Download sound sheet
        </button>
      </div>
    </div>
  );
}
