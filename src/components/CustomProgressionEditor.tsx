"use client";

import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { KEYS } from "@/lib/progressions/music";
import {
  arrangeCustomSteps, customChordStep, deleteCustomProgression, listCustomProgressions, MAX_NAME, MAX_STEPS,
  readCustomProgression, saveCustomProgression, storeCustomDraft, type CustomProgression, type CustomStep, type StepAction,
} from "@/lib/progressions/custom";
import styles from "./CustomProgressionEditor.module.css";

interface Props {
  value: CustomProgression;
  onChange: (next: CustomProgression, index?: number) => void;
  selectedIndex: number;
  onSelect: (index: number) => void;
  draftOpened?: RefObject<boolean>;
}

export default function CustomProgressionEditor({ value, onChange, selectedIndex, onSelect, draftOpened: draftOpenedRef }: Props) {
  const [names, setNames] = useState<string[]>([]);
  const [chosenName, setChosenName] = useState("");
  const [status, setStatus] = useState("");
  const lastValue = useRef(value);
  const restored = useRef<CustomProgression | null>(null);
  const index = Math.max(0, Math.min(selectedIndex, value.steps.length - 1));
  const step = value.steps[index];
  const savedName = names.includes(chosenName) ? chosenName : names[0] ?? "";
  const name = value.name.trim();

  const refreshNames = useEffectEvent(() => {
    try { setNames(listCustomProgressions(window.localStorage)); }
    catch { setStatus("Device storage is unavailable. You can still edit and play this loop."); }
  });
  const restoreDraft = useEffectEvent(() => {
    // Switching modes remounts this editor. Keep the in-memory edits even if disk writes failed.
    if (draftOpenedRef?.current) return;
    if (draftOpenedRef) draftOpenedRef.current = true;
    try {
      restored.current = readCustomProgression(window.localStorage);
      if (restored.current) onChange(restored.current, 0);
    } catch {
      setStatus("Couldn’t open the last draft. You can still edit or load a saved loop.");
    }
  });
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      restoreDraft();
      refreshNames();
    });
    const refresh = () => refreshNames();
    window.addEventListener("storage", refresh);
    return () => {
      mounted = false;
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const persistDraft = useEffectEvent((draft: CustomProgression) => {
    try { storeCustomDraft(window.localStorage, draft); }
    catch { setStatus("Couldn’t keep this draft on your device. Changes are available in this tab."); }
  });
  useEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    if (value !== restored.current) persistDraft(value);
  }, [value]);

  function changeStep(patch: Partial<CustomStep>) {
    onChange({ ...value, steps: value.steps.map((item, i) => i === index ? { ...step, ...patch } : item) }, index);
  }
  function arrange(action: StepAction) {
    const change = arrangeCustomSteps(value.steps, index, action);
    onChange({ ...value, steps: change.steps }, change.index);
  }
  function save() {
    try {
      saveCustomProgression(window.localStorage, value);
      setNames(listCustomProgressions(window.localStorage));
      setChosenName(name);
      setStatus(`Saved “${name}” on this device.`);
    } catch { setStatus("Couldn’t save this loop. Check that this browser allows device storage."); }
  }
  function load() {
    try {
      const loop = readCustomProgression(window.localStorage, savedName);
      if (!loop) {
        setNames(listCustomProgressions(window.localStorage));
        setStatus("That saved loop is no longer on this device.");
        return;
      }
      onChange(loop, 0);
      setStatus(`Loaded “${loop.name}”.`);
    } catch { setStatus("Couldn’t open that saved loop. Your current loop is still available."); }
  }
  function removeSaved() {
    try {
      deleteCustomProgression(window.localStorage, savedName);
      setNames(listCustomProgressions(window.localStorage));
      setStatus(`Deleted the saved copy of “${savedName}”.`);
    } catch { setStatus("Couldn’t delete that saved loop from this device."); }
  }

  return <section className={styles.editor} aria-label="Custom progression editor">
    <h2>Custom progression</h2>
    <label>Chord to edit
      <select value={index} onChange={event => onSelect(Number(event.target.value))}>
        {value.steps.map((item, i) => <option key={i} value={i}>{i + 1} · {customChordStep(item).name}</option>)}
      </select>
    </label>
    <div className={styles.fields}>
      <label>Root note<select value={step.root} onChange={event => changeStep({ root: Number(event.target.value) })}>
        {KEYS.map(key => <option key={key.value} value={key.value}>{key.label}</option>)}
      </select></label>
      <label>Quality<select value={step.quality} onChange={event => changeStep({ quality: event.target.value === "minor" ? "minor" : "major" })}>
        <option value="major">Major</option><option value="minor">Minor</option>
      </select></label>
      <label>Beats<select value={step.beats} onChange={event => changeStep({ beats: Number(event.target.value) })}>
        {Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
      </select></label>
    </div>
    <div className={styles.actions} role="group" aria-label="Arrange chords">
      <button type="button" disabled={value.steps.length >= MAX_STEPS} onClick={() => arrange("add")}>Add chord</button>
      <button type="button" disabled={index === 0} onClick={() => arrange("earlier")}>Move earlier</button>
      <button type="button" disabled={index === value.steps.length - 1} onClick={() => arrange("later")}>Move later</button>
      <button type="button" disabled={value.steps.length === 1} onClick={() => arrange("remove")}>Remove chord</button>
    </div>
    <details className={styles.library}>
      <summary>Save and load loops</summary>
      <div className={styles.libraryRow}>
        <label>Loop name<input type="text" value={value.name} maxLength={MAX_NAME}
          onChange={event => onChange({ ...value, name: event.target.value })} /></label>
        <button type="button" disabled={!name} onClick={save}>{names.includes(name) ? "Update saved loop" : "Save loop"}</button>
      </div>
      {names.length > 0 && <div className={styles.libraryRow}>
        <label>Saved on this device<select value={savedName} onChange={event => setChosenName(event.target.value)}>
          {names.map(item => <option key={item} value={item}>{item}</option>)}
        </select></label>
        <button type="button" onClick={load}>Load</button><button type="button" onClick={removeSaved}>Delete saved copy</button>
      </div>}
    </details>
    <p role="status" className={styles.status}>{status}</p>
  </section>;
}
