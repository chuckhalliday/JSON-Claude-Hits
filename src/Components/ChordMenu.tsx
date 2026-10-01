import { useEffect, useRef, useState } from "react";
import { ChordEvent, Key } from "../Core/theory";
import { ChordChoice, INVERSION_NAMES, inversionOptions, qualityChoices, romanOptions, rootChoices } from "../Core/chordOptions";
import styles from "../Styles/App.module.scss";

export type ChordMenuKind = 'roman' | 'bass' | 'chord';

interface ChordMenuProps {
  kind: ChordMenuKind;
  chord: ChordEvent;
  chordKey: Key;
  alignRight: boolean;
  onPick: (change: Partial<ChordChoice & { inversion: number }>) => void;
  onClose: () => void;
}

// The menu behind a chord cell: functional alternatives (Roman numeral),
// inversions (bass note), or any chord at all (chord symbol).
export default function ChordMenu({ kind, chord, chordKey, alignRight, onPick, onClose }: ChordMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState(chord.root);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Deferred so the click that opened the menu doesn't close it.
    const id = setTimeout(() => document.addEventListener('mousedown', onDown));
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const pick = (change: Partial<ChordChoice & { inversion: number }>) => {
    onPick(change);
    onClose();
  };

  return (
    <div ref={ref} className={`${styles.chordMenu} ${alignRight ? styles.chordMenuRight : ''}`} role="menu">
      {kind === 'roman' && romanOptions(chord, chordKey).map(group => (
        <div key={group.title} className={styles.menuGroup}>
          <div className={styles.menuTitle}>{group.title}</div>
          <div className={styles.menuOptions}>
            {group.options.map(o => (
              <button
                key={o.roman + o.symbol}
                className={o.current ? `${styles.menuOption} ${styles.menuCurrent}` : styles.menuOption}
                onClick={() => pick(o.choice)}
                title={o.symbol}
              >
                <span className={styles.menuRoman}>{o.roman}</span>
                <span className={styles.menuSymbol}>{o.symbol}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {kind === 'bass' && (
        <div className={styles.menuGroup}>
          <div className={styles.menuTitle}>Bass note (inversion)</div>
          <div className={styles.menuOptions}>
            {inversionOptions(chord, chordKey).map(o => (
              <button
                key={o.inversion}
                className={o.current ? `${styles.menuOption} ${styles.menuCurrent}` : styles.menuOption}
                onClick={() => pick({ inversion: o.inversion })}
                title={INVERSION_NAMES[o.inversion]}
              >
                <span className={styles.menuRoman}>{o.bass}</span>
                <span className={styles.menuSymbol}>{o.symbol} · {o.roman}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {kind === 'chord' && (
        <>
          <div className={styles.menuGroup}>
            <div className={styles.menuTitle}>Root</div>
            <div className={styles.menuOptions}>
              {rootChoices(chordKey).map(r => (
                <button
                  key={r.rel}
                  className={r.rel === root ? `${styles.menuOption} ${styles.menuCurrent}` : styles.menuOption}
                  onClick={() => setRoot(r.rel)}
                >
                  <span className={styles.menuRoman}>{r.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={styles.menuGroup}>
            <div className={styles.menuTitle}>Chord</div>
            <div className={styles.menuOptions}>
              {qualityChoices.map(q => (
                <button
                  key={q.quality}
                  className={root === chord.root && q.quality === chord.quality ? `${styles.menuOption} ${styles.menuCurrent}` : styles.menuOption}
                  onClick={() => pick({ root, quality: q.quality, appliedTo: undefined })}
                  title={q.name}
                >
                  <span className={styles.menuRoman}>{rootChoices(chordKey)[root].name}{q.symbol === 'maj' ? '' : q.symbol}</span>
                  <span className={styles.menuSymbol}>{q.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
