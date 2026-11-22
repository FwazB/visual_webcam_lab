export const CHART_SOURCE = "https://huggingface.co/datasets/ailsntua/Chordonomicon";
export const CHART_LICENSE = "https://creativecommons.org/licenses/by-nc/4.0/";

export interface ChartSection {
  name: string;
  chords: string[];
}

export function chartShardPath(id: string) {
  if (!/^[A-Za-z0-9]{22}$/.test(id)) throw new Error("Invalid Spotify track ID");
  let hash = 0;
  for (const character of id) hash = (31 * hash + character.charCodeAt(0)) & 255;
  return "/chord-charts/chordonomicon/" + hash.toString(16).padStart(2, "0") + ".json.gz";
}

export function parseChart(text: string): ChartSection[] {
  const sections: ChartSection[] = [];
  let section: ChartSection = { name: "Progression", chords: [] };
  for (const token of text.match(/\S+/g) ?? []) {
    const marker = /^<([^<>]+)>$/.exec(token);
    if (marker) {
      if (section.chords.length) sections.push(section);
      const label = marker[1].replaceAll("_", " ");
      section = { name: label.charAt(0).toUpperCase() + label.slice(1), chords: [] };
    } else {
      // The corpus writes a sharp as "s" (Fs, D/Fs), including before a suffix (Fssus4).
      section.chords.push(token.replace(/(^|\/)([A-G])s(?!us)/g, "$1$2♯")
        .replace(/(^|\/)([A-G])b/g, "$1$2♭").replace(/^([A-G][♯♭]?)min/, "$1m"));
    }
  }
  if (section.chords.length) sections.push(section);
  return sections;
}

export async function findPublishedChart(id: string, signal: AbortSignal): Promise<ChartSection[] | null> {
  const response = await fetch(chartShardPath(id), { signal });
  if (!response.ok) throw new Error("Chart catalog unavailable");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let text: string;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(stream).text();
  } else {
    // Some hosts apply Content-Encoding and the browser has already decoded the response.
    text = new TextDecoder().decode(bytes);
  }
  const entry = JSON.parse(text)[id];
  if (typeof entry !== "string") return null;
  const sections = parseChart(entry);
  return sections.length ? sections : null;
}
