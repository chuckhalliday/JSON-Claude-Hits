import { configureStore } from '@reduxjs/toolkit'
import { songReducer } from './reducers';

// The development-only invariant checks walk the entire state on every
// dispatch. The song tree and its document are large and are only ever
// replaced through reducers, so walking them on each playback step cost
// 30-50 ms per dispatch in dev builds - enough on its own to make playback
// stutter. The rest of the state is still checked.
const largeSongPaths = ['song.songStructure', 'song.doc', 'song.past'];

const store = configureStore({
    reducer: {
        song: songReducer
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({
        immutableCheck: { ignoredPaths: largeSongPaths },
        serializableCheck: { ignoredPaths: largeSongPaths, ignoredActionPaths: ['payload'] },
    }),
});

// Dispatch type that understands thunks (e.g. `newSong`), for typed useDispatch.
export type AppDispatch = typeof store.dispatch;

export default store;
