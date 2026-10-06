import { useState } from "react";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import Segmented from "@/components/forms/Segmented";
import OrbDemo from "./OrbDemo";

/**
 * Visual verification surface for the design system. Not part of the product -
 * it exists so the type scale, colour tokens and the shared components can be
 * reviewed side by side before feature UI is built on them.
 */
export default function DesignPreview() {
  const [segment, setSegment] = useState("one");
  const [value, setValue] = useState("");

  return (
    <main className="mx-auto max-w-container px-gutter py-12">
      <Section eyebrow="Type">
        <h1>Welcome back, Krishna</h1>
        <h2 className="mt-6">Section heading</h2>
        <h3 className="mt-4">Card heading</h3>
        <p className="mt-4 max-w-2xl text-text-muted">
          Body text is Inter at 16/24. Headings are the same family at weight 500 — no display
          serif, no tight leading. Muted text carries secondary information.
        </p>
        <p className="mt-3 font-mono text-ui text-text-faint">
          Mono is for ids and metrics: r9d30b0e55ac · 142 · $0.37/min
        </p>
      </Section>

      <Section eyebrow="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section eyebrow="Controls">
        <Segmented
          value={segment}
          onChange={setSegment}
          options={[
            { value: "one", label: "Ready-made" },
            { value: "two", label: "Photo" },
            { value: "three", label: "Video clone" },
          ]}
        />
        <div className="mt-6 max-w-sm">
          <Field label="Name" value={value} onChange={setValue} placeholder="Jess" hint="Optional" />
        </div>
      </Section>

      <Section eyebrow="Cards">
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Plain">
            <p className="mt-3 text-ui text-text-muted">A bordered surface with padding.</p>
          </Card>

          <Card
            title="With an action"
            action={
              <span className="rounded-full bg-green-dim px-2.5 py-1 text-label text-green">
                Live
              </span>
            }
          >
            <p className="mt-3 text-h1 font-medium">1,284</p>
          </Card>

          <Card flush hover>
            <div className="flex aspect-[4/3] items-center justify-center bg-surface-2">
              <span className="text-ui text-text-muted">Media fills here</span>
            </div>
            <div className="p-5">
              <h3>Flush + hover</h3>
              <p className="mt-1 text-ui text-text-muted">For cards that are links.</p>
            </div>
          </Card>
        </div>
      </Section>

      <Section eyebrow="Call connecting animation">
        <OrbDemo />
      </Section>

      <Section eyebrow="Palette">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {SWATCHES.map(({ name, token }) => (
            <div key={token} className="rounded-lg border border-border bg-surface p-4">
              <div
                className="mb-3 h-14 w-full rounded border border-border"
                style={{ background: `var(${token})` }}
              />
              <p className="text-ui">{name}</p>
              <p className="mt-0.5 font-mono text-label text-text-faint">{token}</p>
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}

function Section({ eyebrow, children }) {
  return (
    <section className="border-t border-border py-12 first:border-t-0 first:pt-0">
      <p className="mb-6 text-ui text-text-faint">{eyebrow}</p>
      {children}
    </section>
  );
}

const SWATCHES = [
  { name: "Background", token: "--bg" },
  { name: "Surface", token: "--surface" },
  { name: "Surface 2", token: "--surface-2" },
  { name: "Surface 3", token: "--surface-3" },
  { name: "Border", token: "--border" },
  { name: "Border strong", token: "--border-strong" },
  { name: "Text", token: "--text" },
  { name: "Text muted", token: "--text-muted" },
  { name: "Pink", token: "--pink" },
  { name: "Green", token: "--green" },
  { name: "Purple", token: "--purple" },
  { name: "Yellow", token: "--yellow" },
];
