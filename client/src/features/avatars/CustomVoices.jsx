import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { voiceApi } from "@/services/voice.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";

/**
 * "Your voices": the workspace's own cloned voices.
 *
 * A voice is cloned right here - Instant Voice Clone through ElevenLabs - from
 * an uploaded sample or one recorded in the browser. Voices added earlier by a
 * LiveKit Cloud id still show in the list and still work. Like the Knowledge
 * Base, this row saves through its own requests rather than the avatar's
 * autosave; the voice picker above reads the same query.
 */
const KEY = ["custom-voices"];

export function useCustomVoices() {
  return useQuery({ queryKey: KEY, queryFn: voiceApi.list });
}

export default function CustomVoices({ selected, onAdded }) {
  const queryClient = useQueryClient();
  const { data: voices = [], isLoading } = useCustomVoices();
  const [dialog, setDialog] = useState(null); // clone | import

  const added = (voice) => {
    queryClient.invalidateQueries({ queryKey: KEY });
    setDialog(null);
    onAdded?.(voice);
  };

  const remove = useMutation({
    mutationFn: voiceApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="text-body font-medium">Your voices</p>
          <p className="mt-1 max-w-md text-ui text-text-muted">
            Clone your own voice and use it on any avatar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDialog("clone")}
          className="flex h-9 shrink-0 items-center gap-2 rounded-sm border border-border-strong bg-bg px-4 text-ui font-semibold text-text transition-colors hover:bg-surface-3"
        >
          <WaveGlyph />
          Add voice
        </button>
      </div>

      {isLoading && <p className="mt-4 text-ui text-text-muted">Loading voices…</p>}
      {voices.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-bg">
          {voices.map((v) => (
            <li key={v._id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-ui font-medium">
                  {v.name}
                  {selected === v.providerVoiceId && (
                    <span className="ml-2 text-label text-text-muted">· in use</span>
                  )}
                </p>
                <p className="truncate text-label text-text-faint">
                  {v.imported
                    ? "From your ElevenLabs account"
                    : v.provider === "elevenlabs"
                      ? "Instant voice clone"
                      : "Added from LiveKit Cloud"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const also = v.provider === "elevenlabs" && !v.imported ? " It is deleted from ElevenLabs too." : "";
                  if (window.confirm(`Remove "${v.name}" from your voices?${also}`)) remove.mutate(v._id);
                }}
                disabled={remove.isPending}
                aria-label={`Remove ${v.name}`}
                className="shrink-0 rounded-sm px-2 py-1 text-ui text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {remove.error && <p className="mt-2 text-ui text-red">{remove.error.message}</p>}

      {dialog === "clone" && (
        <CloneVoiceDialog onClose={() => setDialog(null)} onImport={() => setDialog("import")} onAdded={added} />
      )}
      {dialog === "import" && <ImportVoiceDialog onClose={() => setDialog(null)} onAdded={added} />}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

// ElevenLabs clones well from 15-60 seconds; much less and the likeness
// suffers, and it accepts files up to about 10 MB.
const MIN_SECONDS = 15;
const MAX_SECONDS = 60;
const MAX_BYTES = 10 * 1024 * 1024;

const SCRIPT =
  "Hi, this is my voice. I'm recording this so my avatar can speak just like me. " +
  "I like to keep things simple and clear, and I try to explain ideas in a friendly way. " +
  "When someone asks me a question, I listen carefully, think for a moment, and then answer honestly. " +
  "Thanks for listening - I'm looking forward to our next conversation.";

/** How long an audio blob plays for, or null if the browser cannot tell. */
function audioSeconds(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const done = (value) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}

/**
 * Instant Voice Clone: a name, an optional description, a 15-60 second sample
 * (uploaded, or recorded here), and the speaker's consent. The sample is only
 * held in this dialog and in the upload; the server passes it to ElevenLabs
 * without storing it.
 */
function CloneVoiceDialog({ onClose, onAdded, onImport }) {
  const { data: caps, isLoading: checking } = useQuery({
    queryKey: ["voice-capabilities"],
    queryFn: voiceApi.capabilities,
  });
  const [recording, setRecording] = useState(false);
  const [sample, setSample] = useState(null); // { blob, name, seconds }
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [fileError, setFileError] = useState(null);
  const [dragging, setDragging] = useState(false);

  const clone = useMutation({
    mutationFn: () =>
      voiceApi.clone({
        name: name.trim(),
        description: description.trim(),
        sample: sample.blob,
        fileName: sample.name,
      }),
    onSuccess: onAdded,
  });

  const pickFile = async (file) => {
    setFileError(null);
    if (!file) return;
    if (!/^(audio|video)\//.test(file.type)) return setFileError("That is not an audio file.");
    if (file.size > MAX_BYTES) return setFileError("Keep the file under 10 MB.");
    const seconds = await audioSeconds(file);
    if (seconds != null && seconds < MIN_SECONDS) {
      return setFileError(`That sample is ${Math.round(seconds)} seconds - use at least ${MIN_SECONDS}.`);
    }
    setSample({ blob: file, name: file.name, seconds: seconds && Math.round(seconds) });
  };

  const unavailable = !checking && !caps?.cloning;
  const ready = sample && name.trim() && consent && !clone.isPending && !unavailable;

  return (
    <Modal
      open
      onClose={() => !clone.isPending && onClose()}
      title="Clone New Voice"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={clone.isPending}>
            Cancel
          </Button>
          <Button onClick={() => clone.mutate()} disabled={!ready}>
            {clone.isPending ? "Cloning…" : "Add Voice"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {unavailable && (
          <p className="rounded border border-border-strong bg-surface-2 px-4 py-3 text-ui text-yellow">
            Voice cloning is not set up on this server yet. Add ELEVENLABS_API_KEY to server/.env and restart
            the server.
          </p>
        )}
        {!unavailable && (
          <p className="text-ui text-text-muted">
            Already cloned it on ElevenLabs?{" "}
            <button type="button" onClick={onImport} className="text-pink hover:underline">
              Add it by its voice ID
            </button>
          </p>
        )}

        <Field label="Name">
          <input
            value={name}
            maxLength={60}
            autoFocus
            placeholder="Enter voice name"
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Description">
          <input
            value={description}
            maxLength={300}
            placeholder="Enter voice description (optional)"
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </Field>

        <div>
          <p className="text-ui font-medium">Upload Voice Sample</p>
          <p className="mt-0.5 text-label text-text-muted">
            Upload a {MIN_SECONDS}-{MAX_SECONDS}s audio sample of the voice you want to clone.
          </p>

          {recording ? (
            <div className="mt-2.5">
              <Recorder
                onSample={(s) => {
                  setSample(s);
                  if (s) setRecording(false);
                }}
                disabled={clone.isPending}
              />
              <button
                type="button"
                onClick={() => setRecording(false)}
                className="mt-2 text-label text-text-faint hover:text-text-muted"
              >
                Upload a file instead
              </button>
            </div>
          ) : (
            <>
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pickFile(e.dataTransfer.files?.[0]);
                }}
                className={clsx(
                  "mt-2.5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border px-4 py-6 text-center transition-colors",
                  dragging ? "border-pink bg-pink-dim" : "border-border bg-surface-2 hover:bg-surface-3",
                )}
              >
                <UploadGlyph />
                <span className="text-ui font-medium">
                  {sample ? sample.name : "Drag and drop an audio file here, or click to select"}
                </span>
                <span className="text-label text-text-faint">
                  {sample?.seconds
                    ? `${sample.seconds} seconds · click to change`
                    : "MP3, WAV, M4A, OGG or WEBM · up to 10 MB"}
                </span>
                <input
                  type="file"
                  accept="audio/*"
                  className="sr-only"
                  disabled={clone.isPending}
                  onChange={(e) => pickFile(e.target.files?.[0])}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setRecording(true);
                  setFileError(null);
                }}
                className="mt-2 text-label text-text-faint hover:text-text-muted"
              >
                No recording? Record one in your browser
              </button>
            </>
          )}
          {fileError && <p className="mt-2 text-ui text-red">{fileError}</p>}
          {sample && <Playback blob={sample.blob} />}
        </div>

        <label className="flex cursor-pointer items-start gap-3 text-ui text-text">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[color:var(--pink)]"
          />
          <span>
            I hereby confirm that I have all necessary rights or consents to upload and clone this voice sample
            and that I will not use the platform-generated content for any illegal, fraudulent, or harmful
            purpose.
          </span>
        </label>

        {clone.error && (
          <p className="text-ui text-red">{clone.error.details?.[0]?.message || clone.error.message}</p>
        )}
      </div>
    </Modal>
  );
}

/**
 * A voice already in the ElevenLabs account - cloned on elevenlabs.io rather
 * than here - added by its voice id. The server checks it with ElevenLabs.
 */
function ImportVoiceDialog({ onClose, onAdded }) {
  const [voiceId, setVoiceId] = useState("");
  const [name, setName] = useState("");
  const add = useMutation({
    mutationFn: () => voiceApi.importElevenLabs({ voiceId: voiceId.trim(), name: name.trim() || undefined }),
    onSuccess: onAdded,
  });
  const ready = /^[A-Za-z0-9]{10,40}$/.test(voiceId.trim()) && !add.isPending;

  return (
    <Modal
      open
      onClose={() => !add.isPending && onClose()}
      title="Add an ElevenLabs voice"
      description="For a voice you cloned on elevenlabs.io. In ElevenLabs open My Voices, click the voice's ⋯ menu and copy its ID."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button onClick={() => add.mutate()} disabled={!ready}>
            {add.isPending ? "Checking…" : "Add Voice"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Voice ID">
          <input
            value={voiceId}
            autoFocus
            maxLength={40}
            placeholder="e.g. 21m00Tcm4TlvDq8ikWAM"
            onChange={(e) => setVoiceId(e.target.value)}
            className={clsx(inputClass, "font-mono")}
          />
        </Field>
        <Field label="Name">
          <input
            value={name}
            maxLength={60}
            placeholder="Optional - the ElevenLabs name is used otherwise"
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </Field>
        {add.error && <p className="text-ui text-red">{add.error.details?.[0]?.message || add.error.message}</p>}
      </div>
    </Modal>
  );
}

/**
 * Records from the microphone with a script to read, a running timer and a
 * cap at the longest useful sample. Too-short takes are refused here, where
 * re-recording is one click, rather than after an upload.
 */
function Recorder({ onSample, disabled }) {
  const [active, setActive] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState(null);
  const recorder = useRef(null);
  const timer = useRef(null);

  const stopTracks = () => recorder.current?.stream.getTracks().forEach((t) => t.stop());

  // Leaving mid-take releases the microphone.
  useEffect(
    () => () => {
      clearInterval(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stopTracks();
    },
    [],
  );

  const start = async () => {
    setError(null);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setError("Microphone access was blocked. Allow it in the browser, or upload a file instead.");
      return;
    }

    const chunks = [];
    const rec = new MediaRecorder(stream);
    const startedAt = Date.now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      clearInterval(timer.current);
      stopTracks();
      setActive(false);
      const took = Math.round((Date.now() - startedAt) / 1000);
      if (took < MIN_SECONDS) {
        setError(`That was ${took} seconds - record at least ${MIN_SECONDS}.`);
        return;
      }
      const type = rec.mimeType || "audio/webm";
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      onSample({ blob: new Blob(chunks, { type }), name: `recording.${ext}`, seconds: took });
    };

    recorder.current = rec;
    rec.start();
    onSample(null);
    setSeconds(0);
    setActive(true);
    timer.current = setInterval(() => {
      const s = Math.round((Date.now() - startedAt) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) rec.stop();
    }, 250);
  };

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-4">
      <p className="text-label font-medium uppercase tracking-wider text-text-faint">Read this aloud</p>
      <p className="mt-2 text-ui leading-relaxed text-text">{SCRIPT}</p>

      <div className="mt-4 flex items-center gap-3">
        <Button
          size="sm"
          variant={active ? "danger" : "primary"}
          onClick={active ? () => recorder.current?.stop() : start}
          disabled={disabled}
        >
          {active ? <StopGlyph /> : <MicGlyph />}
          {active ? "Stop" : "Start recording"}
        </Button>
        {active && (
          <span className="flex items-center gap-2 text-ui tabular-nums text-text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red" aria-hidden />
            {formatTime(seconds)} / {formatTime(MAX_SECONDS)}
          </span>
        )}
      </div>
      <p className="mt-3 text-label text-text-faint">
        A quiet room and your normal speaking voice give the best clone.
      </p>
      {error && <p className="mt-2 text-ui text-red">{error}</p>}
    </div>
  );
}

/** Lets people hear the sample before it is sent. */
function Playback({ blob }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? <audio controls src={url} className="mt-3 h-10 w-full [color-scheme:dark]" /> : null;
}

const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const inputClass =
  "h-10 w-full rounded border border-border bg-bg px-4 text-ui text-text outline-none transition-colors placeholder:text-text-faint focus:border-border-strong";

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-ui font-medium">{label}</span>
      {children}
    </label>
  );
}

const glyph = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

function WaveGlyph() {
  return (
    <svg {...glyph} width="15" height="15" viewBox="0 0 16 16">
      <path d="M2 6.5v3M4.5 4v8M7 2v12M9.5 5v6M12 3.5v9M14.5 6.5v3" />
    </svg>
  );
}

function UploadGlyph() {
  return (
    <svg {...glyph} width="22" height="22" viewBox="0 0 24 24" className="text-text-muted">
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function MicGlyph() {
  return (
    <svg {...glyph} width="14" height="14" viewBox="0 0 16 16">
      <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="3" y="3" width="10" height="10" rx="2" />
    </svg>
  );
}
