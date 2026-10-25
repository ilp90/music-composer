import * as Tone from 'tone';

/**
 * Synth for the compose view. Built on Tone.js; a synthesized voice (no sample downloads)
 * so playback works as soon as the page has loaded, even offline.
 */
export class AudioEngine {
  private constructor(private readonly synth: Tone.PolySynth) {}

  /**
   * Must be called from a user gesture (click/tap): browsers keep the AudioContext suspended until then.
   * Call it before any other `await` in the handler so the gesture is still "active".
   */
  static async start(): Promise<AudioEngine> {
    await Tone.start();
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.25, sustain: 0.35, release: 1.2 },
    }).toDestination();
    synth.volume.value = -8;
    return new AudioEngine(synth);
  }

  /** Plays MIDI notes together (a single note or a chord). */
  play(midiNotes: readonly number[]): void {
    const frequencies = midiNotes.map((m) => Tone.Frequency(m, 'midi').toFrequency());
    this.synth.triggerAttackRelease(frequencies, '2n');
  }

  /**
   * Audio for a recording: the synth plus the microphone, mixed into one stream. The mic goes only
   * to the recording, never to the speakers (no feedback). Call `dispose` when the recording stops.
   */
  createRecordingAudio(mic: MediaStream | null): { stream: MediaStream; dispose(): void } {
    const context = Tone.getContext().rawContext as AudioContext;
    const destination = context.createMediaStreamDestination();
    this.synth.connect(destination);
    const micSource = mic?.getAudioTracks().length ? context.createMediaStreamSource(mic) : null;
    micSource?.connect(destination);
    return {
      stream: destination.stream,
      dispose: () => {
        this.synth.disconnect(destination);
        micSource?.disconnect();
      },
    };
  }

  dispose(): void {
    this.synth.releaseAll();
    this.synth.dispose();
  }
}
