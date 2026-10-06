import { useState } from "react";
import clsx from "clsx";
import MediaPreview from "@/components/media/MediaPreview";
import KnowledgeBase from "./KnowledgeBase";
import McpServers from "./McpServers";
import CustomVoices, { useCustomVoices } from "./CustomVoices";
import EditVisualsDialog from "./EditVisualsDialog";

/**
 * An avatar's settings, laid out like LemonSlice's: a section label with a
 * coloured icon, then a rounded card of rows.
 *
 * Every field saves itself through `onChange` (a partial patch - see
 * useAutosave). Only settings the call pipeline actually honours are here:
 * voice and speed go to our TTS, the model and brief to our language model,
 * aspect ratio, render model and movement prompts to LemonSlice.
 *
 * The form keeps its own draft, seeded once from the avatar, so a save landing
 * mid-sentence never overwrites what is being typed.
 */

const ASPECT_CLASS = { "2x3": "aspect-[2/3]", "9x16": "aspect-[9/16]", "1x1": "aspect-square" };

const DURATIONS = [
  { value: 300, label: "5 minutes" },
  { value: 900, label: "15 minutes" },
  { value: 1800, label: "30 minutes" },
  { value: 3600, label: "1 hour" },
];

export default function AvatarSettings({ avatar, options, onChange }) {
  const persona = avatar.personaId || {};
  const [draft, setDraft] = useState(() => ({
    render: {
      aspectRatio: avatar.render?.aspectRatio || "2x3",
      model: avatar.render?.model || "standard",
    },
    persona: {
      greeting: persona.greeting || "",
      voice: persona.voice || "",
      voiceSpeed: persona.voiceSpeed ?? 1,
      language: persona.language || "en",
      systemPrompt: persona.systemPrompt || "",
      useDefaultPrompt: Boolean(persona.useDefaultPrompt),
      llmModel: persona.llmModel || "",
      motionPrompt: persona.motionPrompt || "",
      idlePrompt: persona.idlePrompt || "",
      maxCallSeconds: persona.maxCallSeconds || "",
    },
  }));

  const setPersona = (patch, opts) => {
    setDraft((d) => ({ ...d, persona: { ...d.persona, ...patch } }));
    onChange({ persona: patch }, opts);
  };
  const setRender = (patch) => {
    setDraft((d) => ({ ...d, render: { ...d.render, ...patch } }));
    onChange({ render: patch }, { now: true });
  };

  const p = draft.persona;
  const voices = options?.voices || [];
  const { data: customVoices = [] } = useCustomVoices();
  const voice = p.voice || options?.defaultVoice || "";
  const known = voices.some((v) => v.id === voice) || customVoices.some((v) => v.providerVoiceId === voice);
  const llms = options?.llmModels || [];
  const llm = p.llmModel || options?.defaultLlmModel || "";
  const chosenLlm = llms.find((m) => m.id === llm);

  return (
    <div className="mx-auto max-w-[700px] space-y-10 px-6 pb-20 pt-2">
      <section>
        <SectionTitle icon={<PersonIcon />} tone="bg-text text-text-inverse">
          Avatar visuals
        </SectionTitle>
        <Visuals avatar={avatar} render={draft.render} options={options} onRender={setRender} />
      </section>

      <section>
        <div className="rounded-xl border border-border bg-surface-2 p-6">
          <p className="text-body font-medium">Greeting message</p>
          <p className="mt-1 text-ui text-text-muted">
            The first thing the avatar says when someone joins a call.
          </p>
          <TextArea
            value={p.greeting}
            maxLength={400}
            rows={3}
            placeholder="Hi! What can I help you with today?"
            onChange={(greeting) => setPersona({ greeting })}
            counter
          />
        </div>
      </section>

      <section>
        <SectionTitle icon={<WaveIcon />} tone="bg-orange text-white">
          Voice
        </SectionTitle>
        <Card>
          <Row title="Voice">
            <Select
              value={voice}
              onChange={(value) => setPersona({ voice: value }, { now: true })}
              disabled={!voices.length && !customVoices.length}
              title={
                voices.length || customVoices.length
                  ? undefined
                  : "This TTS model has no voice list; the install default is used."
              }
            >
              {!known && voice && <option value={voice}>{voice}</option>}
              {customVoices.length > 0 && (
                <optgroup label="Your voices">
                  {customVoices.map((v) => (
                    <option key={v._id} value={v.providerVoiceId}>
                      {v.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {["female", "male"].map((g) => (
                <optgroup key={g} label={g === "female" ? "Female" : "Male"}>
                  {voices
                    .filter((v) => v.gender === g)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.id} — {v.description}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          </Row>
          <CustomVoices
            selected={voice}
            // A freshly added voice is almost always wanted on the avatar at hand.
            onAdded={(v) => setPersona({ voice: v.providerVoiceId }, { now: true })}
          />
          <Row title="Voice speed">
            <div className="flex w-[200px] items-center gap-3">
              <span className="w-9 text-right text-ui tabular-nums text-text-muted">
                {Number(p.voiceSpeed).toFixed(2)}
              </span>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={p.voiceSpeed}
                aria-label="Voice speed"
                onChange={(e) => setPersona({ voiceSpeed: Number(e.target.value) })}
                className="h-1 flex-1 cursor-pointer accent-[color:var(--text)]"
              />
            </div>
          </Row>
          <Row
            title="Language"
            description="The language your avatar listens and speaks in. For best results, write the instructions below in the same language."
          >
            <Select value={p.language} onChange={(language) => setPersona({ language }, { now: true })}>
              {(options?.languages || [{ code: "en", label: "English" }]).map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Row>
        </Card>
      </section>

      <section>
        <SectionTitle icon={<PersonalityIcon />} tone="bg-teal text-text-inverse">
          Personality
        </SectionTitle>
        <Card>
          <Row
            stacked
            title="System Prompt"
            description="Used to determine what the avatar says, and the context of the conversation."
          >
            <TextArea
              mono
              value={p.systemPrompt}
              maxLength={4000}
              rows={6}
              placeholder={options?.defaultPrompt}
              onChange={(systemPrompt) => setPersona({ systemPrompt })}
            />
          </Row>
          <Row title="Default personality" description="Appends recommended prompt to your system prompt.">
            <Toggle
              checked={p.useDefaultPrompt}
              label="Default personality"
              onChange={(useDefaultPrompt) => setPersona({ useDefaultPrompt }, { now: true })}
            />
          </Row>
          <Row
            title="LLM"
            description={
              chosenLlm && !chosenLlm.available
                ? `${chosenLlm.unavailableReason}. Calls use ${options.defaultLlmModel} until then.`
                : "LLM choice will impact agent's response quality and latency."
            }
          >
            <Select value={llm} onChange={(llmModel) => setPersona({ llmModel }, { now: true })}>
              {llms.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.available}>
                  {m.label}
                  {m.available ? "" : ` (${m.unavailableReason})`}
                </option>
              ))}
            </Select>
          </Row>
          <KnowledgeBase avatarId={avatar._id} />
          <McpServers avatarId={avatar._id} />
        </Card>
      </section>

      <section>
        <SectionTitle icon={<MotionIcon />} tone="bg-purple text-text-inverse">
          Behaviour
        </SectionTitle>
        <Card>
          <Row stacked title="Talking movement" description="How the avatar moves and looks while it speaks.">
            <TextInput
              value={p.motionPrompt}
              maxLength={400}
              placeholder="a person talking"
              onChange={(motionPrompt) => setPersona({ motionPrompt })}
            />
          </Row>
          <Row stacked title="Idle movement" description="How it looks while it listens or waits.">
            <TextInput
              value={p.idlePrompt}
              maxLength={400}
              placeholder="a calm person waiting"
              onChange={(idlePrompt) => setPersona({ idlePrompt })}
            />
          </Row>
          <Row title="Maximum call length" description="Calls end automatically after this.">
            <Select
              value={p.maxCallSeconds}
              onChange={(value) => setPersona({ maxCallSeconds: value ? Number(value) : "" }, { now: true })}
            >
              <option value="">Default</option>
              {DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Row>
        </Card>
      </section>
    </div>
  );
}

/** The face on a blurred copy of itself, with the render controls under it. */
function Visuals({ avatar, render, options, onRender }) {
  // Aspect ratio and render model are LemonSlice session options; other
  // vendors would silently ignore them.
  const renderable = avatar.providerId === "lemonslice";
  const unsupported = renderable ? undefined : "Only LemonSlice avatars have render options";

  // A LemonSlice agent's face is managed in LemonSlice's own dashboard.
  const [editing, setEditing] = useState(false);
  const isAgent = /^agent_/.test(avatar.providerAvatarId || "");
  const editBlocked = isAgent
    ? "This avatar is a LemonSlice agent - change its face in the LemonSlice dashboard"
    : undefined;
  const editable = !isAgent;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface-3">
      {avatar.previewUrl && (
        <img
          src={avatar.previewUrl}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-3xl"
        />
      )}
      <div className="absolute inset-0 bg-black/25" aria-hidden />

      <div className="relative flex flex-col items-center px-6 pb-6 pt-7">
        <div
          className={clsx(
            "h-[390px] max-w-full overflow-hidden rounded-xl border border-white/10 shadow-lg",
            ASPECT_CLASS[render.aspectRatio],
          )}
        >
          {avatar.previewVideoUrl ? (
            <video
              src={avatar.previewVideoUrl}
              poster={avatar.previewUrl}
              autoPlay
              muted
              loop
              playsInline
              aria-label={avatar.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <MediaPreview src={avatar.previewUrl} alt={avatar.name} className="h-full w-full object-cover" />
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={!editable}
            title={editable ? "Give this avatar a new face" : editBlocked}
            className="flex h-9 items-center gap-2 rounded-full border border-white/10 bg-black/55 px-4 text-ui font-medium text-white backdrop-blur transition-colors hover:bg-black/70 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PencilIcon />
            Edit avatar visuals
          </button>
          <PillSelect
            icon={<FrameIcon />}
            value={render.aspectRatio}
            onChange={(aspectRatio) => onRender({ aspectRatio })}
            disabled={!renderable}
            title={unsupported || "Aspect ratio"}
          >
            {(options?.aspectRatios || [{ id: "2x3", label: "2:3" }]).map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </PillSelect>
          <PillSelect
            value={render.model}
            onChange={(model) => onRender({ model })}
            disabled={!renderable}
            title={unsupported || "Render model"}
          >
            {(options?.renderModels || [{ id: "standard", label: "Standard" }]).map((m) => (
              <option key={m.id} value={m.id}>
                {/* What a minute costs in credits is part of the choice. */}
                {m.label}
                {credits?.rates?.[m.id] ? ` · ${credits.rates[m.id]} credits/min` : ""}
              </option>
            ))}
          </PillSelect>
        </div>
      </div>

      {editing && <EditVisualsDialog avatar={avatar} onClose={() => setEditing(false)} />}
    </div>
  );
}

function SectionTitle({ icon, tone, children }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className={clsx("flex h-9 w-9 items-center justify-center rounded-full", tone)}>{icon}</span>
      <h2 className="text-ui font-semibold">{children}</h2>
    </div>
  );
}

function Card({ children }) {
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-surface-2">{children}</div>
  );
}

function Row({ title, description, stacked = false, children }) {
  return (
    <div className={clsx("px-6 py-5", !stacked && "flex items-center justify-between gap-6")}>
      <div className="min-w-0">
        <p className="text-body font-medium">{title}</p>
        {description && <p className="mt-1 max-w-md text-ui text-text-muted">{description}</p>}
      </div>
      <div className={stacked ? "mt-4" : "shrink-0"}>{children}</div>
    </div>
  );
}

function Select({ value, onChange, children, disabled, title }) {
  return (
    <div className="relative" title={title}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-[220px] cursor-pointer appearance-none truncate rounded border border-border bg-bg pl-4 pr-9 text-ui font-medium text-text outline-none transition-colors [color-scheme:dark] hover:border-border-strong focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
    </div>
  );
}

function PillSelect({ icon, value, onChange, children, disabled, title }) {
  return (
    <div className="relative" title={title}>
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white">{icon}</span>
      )}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(
          "h-9 cursor-pointer appearance-none rounded-full border border-white/10 bg-black/55 pr-8 text-ui font-medium text-white outline-none backdrop-blur [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-60",
          icon ? "pl-9" : "pl-4",
        )}
      >
        {children}
      </select>
      <UpDownIcon className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white" />
    </div>
  );
}

function TextArea({ value, onChange, maxLength, rows, placeholder, mono = false, counter = false }) {
  return (
    <div className="relative mt-4">
      <textarea
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(
          "w-full resize-y rounded-lg border border-border bg-bg px-4 py-3 text-ui leading-relaxed text-text outline-none transition-colors placeholder:text-text-faint focus:border-border-strong",
          mono && "font-mono",
          counter && "pb-8",
        )}
      />
      {counter && (
        <span className="pointer-events-none absolute bottom-3 right-4 text-label tabular-nums text-text-faint">
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  );
}

function TextInput({ value, onChange, maxLength, placeholder }) {
  return (
    <input
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded border border-border bg-bg px-4 text-ui text-text outline-none transition-colors placeholder:text-text-faint focus:border-border-strong"
    />
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative h-6 w-10 rounded-full transition-colors",
        checked ? "bg-text" : "bg-surface-3",
      )}
    >
      <span
        className={clsx(
          "absolute left-0 top-1 h-4 w-4 rounded-full transition-transform duration-200 ease-ease",
          checked ? "translate-x-5 bg-text-inverse" : "translate-x-1 bg-text",
        )}
      />
    </button>
  );
}

const stroke = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

function ChevronDownIcon({ className }) {
  return (
    <svg {...stroke} className={className}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function UpDownIcon({ className }) {
  return (
    <svg {...stroke} width={14} height={14} className={className}>
      <path d="M5 6l3-3 3 3M5 10l3 3 3-3" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg {...stroke}>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3.5 13.5c.6-2.3 2.4-3.5 4.5-3.5s3.9 1.2 4.5 3.5" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg {...stroke}>
      <path d="M2.5 7v2M5 5v6M8 3v10M11 5v6M13.5 7v2" />
    </svg>
  );
}

function PersonalityIcon() {
  return (
    <svg {...stroke}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
      <path d="M5.5 6.5h5M5.5 9.5h3" />
    </svg>
  );
}

function MotionIcon() {
  return (
    <svg {...stroke}>
      <path d="M2.5 8c1.5-3 3-3 4.5 0s3 3 4.5 0M11.5 8h2" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg {...stroke} width={14} height={14}>
      <path d="M10.5 2.5l3 3L6 13H3v-3z" />
    </svg>
  );
}

function FrameIcon() {
  return (
    <svg {...stroke} width={14} height={14}>
      <rect x="4.5" y="2" width="7" height="12" rx="1.5" />
    </svg>
  );
}
