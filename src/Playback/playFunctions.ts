export function wait(time: number) {
  return new Promise(resolve => setTimeout(resolve, time * 1000));
}

// MIDI access is requested once and its ports looked up by name and cached,
// instead of a fresh requestMIDIAccess() round trip for every note.
let midiAccess: Promise<WebMidi.MIDIAccess> | null = null;
const outputsByBus = new Map<string, WebMidi.MIDIOutput | null>();

async function outputFor(bus: string): Promise<WebMidi.MIDIOutput | null> {
  if (outputsByBus.has(bus)) return outputsByBus.get(bus)!;
  midiAccess = midiAccess ?? navigator.requestMIDIAccess();
  const access = await midiAccess;
  let found: WebMidi.MIDIOutput | null = null;
  for (const output of access.outputs.values()) {
    if (output.name === `IAC Driver Bus ${bus}`) {
      found = output;
      break;
    }
  }
  if (!found) {
    console.log(`Output device 'IAC Driver Bus ${bus}' not found.`);
  }
  outputsByBus.set(bus, found);
  // Re-scan if ports are plugged in or removed.
  access.onstatechange = () => outputsByBus.clear();
  return found;
}

export async function triggerMidi(bus: string, note: number, duration: number, velocity: number, release: number) {
  try {
    const outputDevice = await outputFor(bus);
    if (!outputDevice) return;
    outputDevice.send([0x90, note, velocity]);
    outputDevice.send([0x80, note, release], performance.now() + duration * 1000);
  } catch (error) {
    midiAccess = null;
    console.log("MIDI access request failed:", error);
  }
}
