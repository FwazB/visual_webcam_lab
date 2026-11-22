import { KEYS } from "./music";
import type { SongStep } from "./songPath";

export type CustomStep = Pick<SongStep, "root" | "quality" | "beats">;
export interface CustomProgression {
  name: string;
  bpm: number;
  steps: CustomStep[];
}

export const MAX_STEPS = 16;
export const MAX_NAME = 80;
const DRAFT = "bodysynth.progressions.v1.draft";
const SAVED = "bodysynth.progressions.v1.saved.";

export function createCustomProgression(): CustomProgression {
  return { name: "", bpm: 84, steps: [{ root: 0, quality: "major", beats: 4 }] };
}

export function customChordStep(step: CustomStep): SongStep {
  return { ...step, name: KEYS[step.root].label + (step.quality === "minor" ? "m" : ""), numeral: "" };
}

export type StepAction = "add" | "remove" | "earlier" | "later";

export function arrangeCustomSteps(steps: CustomStep[], index: number, action: StepAction) {
  const next = steps.slice();
  const destination = action === "earlier" ? index - 1 : index + 1;
  if (action === "add" && next.length < MAX_STEPS) {
    next.splice(destination, 0, { ...steps[index] });
    return { steps: next, index: destination };
  }
  if (action === "remove" && next.length > 1) {
    next.splice(index, 1);
    return { steps: next, index: Math.min(index, next.length - 1) };
  }
  if ((action === "earlier" || action === "later") && destination >= 0 && destination < next.length) {
    [next[index], next[destination]] = [next[destination], next[index]];
    return { steps: next, index: destination };
  }
  return { steps, index };
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && min <= value && value <= max;
}

function validStep(step: unknown): step is CustomStep {
  return typeof step === "object" && step !== null &&
    "root" in step && integer(step.root, 0, 11) &&
    "quality" in step && (step.quality === "major" || step.quality === "minor") &&
    "beats" in step && integer(step.beats, 1, 16);
}

export function readCustomProgression(storage: Storage, savedName?: string): CustomProgression | null {
  const raw = storage.getItem(savedName === undefined ? DRAFT : SAVED + savedName);
  if (raw === null) return null;
  const data = JSON.parse(raw);
  if (typeof data?.name !== "string" || data.name.length > MAX_NAME ||
      (savedName !== undefined && data.name !== savedName) || !integer(data.bpm, 50, 160) ||
      !Array.isArray(data.steps) || data.steps.length < 1 || data.steps.length > MAX_STEPS ||
      !data.steps.every(validStep)) {
    throw new Error("Invalid saved progression");
  }
  return { name: data.name, bpm: data.bpm, steps: data.steps.map(({ root, quality, beats }: CustomStep) => ({ root, quality, beats })) };
}

export function storeCustomDraft(storage: Storage, draft: CustomProgression) {
  storage.setItem(DRAFT, JSON.stringify(draft));
}

export function saveCustomProgression(storage: Storage, draft: CustomProgression) {
  const name = draft.name.trim();
  if (!name || name.length > MAX_NAME) throw new Error("Invalid progression name");
  storage.setItem(SAVED + name, JSON.stringify({ ...draft, name }));
}

export function listCustomProgressions(storage: Storage) {
  const names: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(SAVED)) {
      const name = key.slice(SAVED.length);
      if (name && name.length <= MAX_NAME) names.push(name);
    }
  }
  return names.sort((a, b) => a.localeCompare(b));
}

export function deleteCustomProgression(storage: Storage, name: string) {
  storage.removeItem(SAVED + name);
}
