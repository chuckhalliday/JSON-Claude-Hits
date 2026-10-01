import { useState, useEffect, useRef } from "react";
import { useSelector, useDispatch } from "react-redux"
import { SongState, setSong } from "../reducers";
import styles from "../Styles/App.module.scss";
import { supabase } from '../supabaseClient'


interface SaveProps {
    onClose: () => void;
  }

export default function Save({ onClose }: SaveProps) {
    const song = useSelector((state: { song: SongState }) => state.song)

    const saveRef = useRef<HTMLDivElement | null>(null);
    const [name, setName] = useState<string>('');
    const [user, setUser] = useState<string | null>(null); // State to store user
    const [savedComps, setSavedComps] = useState<any[]>([]); // State to store saved components
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
      async function fetchData() {
        try {
          const userData = await getUser();
          setUser(userData);
          const songsData = await getSongs(userData);
          setSavedComps(songsData);
        } catch (err) {
          setLoadError('Failed to load saved songs. Please try again.');
          console.error(err);
        }
      }

      fetchData();
    }, []);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
          if (saveRef.current && !saveRef.current.contains(e.target as Node)) {
            onClose();
          }
        }
          document.addEventListener("mousedown", handler);
  
          return () => {
            document.removeEventListener("mousedown", handler);
          };
        }, []);

    const getUser = async () => {
        const { data: { user }, error } = await supabase.auth.getUser()
        if (error) {
            throw error
        }
        return user ? user.id : null
    }

    const getSongs = async (user: string | null) => {
        if (!user) {
          return [];
        }

        let { data: songs, error } = await supabase
          .from('songs')
          .select()
          .eq('user', user)
        if (error) {
            throw error
        }
        return songs || [];
      }

      const dispatch = useDispatch()

      const updateSong = (data: SongState) => {
        dispatch(setSong(data))
        onClose()
      }

    // Undo history stays in the session; it isn't part of the saved song.
    const { past: _past, ...savable } = song;

    const save = async () => {
        if(name === ''){
            alert('Please name the song')
            return
        }

        const { data: existing, error: lookupError } = await supabase
            .from('songs')
            .select()
            .eq('user', user)
            .eq('name', name)

        if (lookupError) {
            alert(`Failed to save ${name}: ${lookupError.message}`)
            return
        }

        if (existing && existing.length > 0) {
            const { error } = await supabase
            .from('songs')
            .update([{data: savable}])
            .eq('name', name)
            .select()
            if (error) {
                alert(`Failed to update ${name}: ${error.message}`)
                return
            }
            alert(`${name} updated!`)
            onClose()
        } else {
            const { error } = await supabase
            .from('songs')
            .insert([{data: savable, name: name, user: user}])
            .select()
            if (error) {
                alert(`Failed to create ${name}: ${error.message}`)
                return
            }
            alert(`${name} created!`)
            onClose()
        }
      }

    return (
        <div className={styles.generateContainer} ref={saveRef}>
          <button onClick={onClose}>x</button>
            <div>
                <h2>Save Your Song</h2>
                <form>
          <label>Name:</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)} // Update the name state when input changes
          />
          <button type="button" onClick={save}>
            Save
          </button>
        </form>
            <div>
                <h2>Load Previous</h2>
                {loadError && <p className={styles.error}>{loadError}</p>}
            </div>
            <div>
          {savedComps.map((comp) => {
            return (
              <div key={comp.name}>
                <button onClick={() => updateSong(comp.data)}>{comp.name}</button>
              </div>
            )
          })}
        </div>
            </div>

        </div>
    )
}