import { useCallback } from 'react';
import { useDispatch, useStore } from 'react-redux';
import { lampToPositions } from '../SongStructure/beatMapping';
import { setCurrentBeat, SongState } from '../reducers';

export function useLampStep(
  lampsRef: React.MutableRefObject<HTMLInputElement[]>,
  part: number,
  drumGroove: number[],
  bassGroove: number[],
  chordsGroove: number[],
) {
  const dispatch = useDispatch();
  const store = useStore<{ song: SongState }>();
  return useCallback((lampIndex: number) => {
    const lamp = lampsRef.current[lampIndex];
    if (lamp) {
      lamp.checked = true;
      // Instant, not 'smooth': this fires on every 16th-note step during playback,
      // and a smooth-scroll animation on that cadence is main-thread work that can
      // delay pending sample-load promises past their scheduled audio-clock time.
      lamp.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    // Positions only advance where the drum, bass and chord grids line up, so
    // most steps leave them unchanged. Skipping those dispatches spares a
    // re-render of every connected component on each step.
    const next = [part, ...lampToPositions(lampIndex, drumGroove, bassGroove, chordsGroove)];
    const current = store.getState().song.selectedBeat;
    if (next.every((value, i) => value === current[i])) return;
    dispatch(setCurrentBeat(next));
  }, [lampsRef, part, drumGroove, bassGroove, chordsGroove, dispatch, store]);
}
