import type { EqBand, EqPreset } from "@shared/library-types";

export type Html5AudioGraph = {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  filters: BiquadFilterNode[];
  analyser: AnalyserNode;
};

const EQ_STAGES: Record<Exclude<EqPreset, "flat">, EqBand[]> = {
  "voice-clarity": [
    { type: "highpass", frequency: 120, gain: 0 },
    { type: "peaking", frequency: 3000, gain: 4, Q: 1.2 },
    { type: "peaking", frequency: 6000, gain: 3, Q: 1.0 },
  ],
  "bass-boost": [
    { type: "lowshelf", frequency: 200, gain: 6 },
    { type: "peaking", frequency: 500, gain: -2, Q: 1.0 },
  ],
};

let sharedAudioContext: AudioContext | null = null;

/**
 * Single shared `AudioContext` for the renderer (EQ, skip-silence analyser, routing).
 * Not tied to any third-party player library.
 */
export function acquireAudioContext(): AudioContext {
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContext();
  }
  return sharedAudioContext;
}

/** `createMediaElementSource` is only valid once per element; reuse the graph shell across tracks. */
const graphByAudioElement = new WeakMap<HTMLAudioElement, Html5AudioGraph>();

function applyEqBand(f: BiquadFilterNode, band: EqBand): void {
  f.frequency.value = band.frequency;
  if (band.type === "highpass") {
    f.type = "highpass";
    f.Q.value = 0.7;
  } else if (band.type === "lowshelf") {
    f.type = "lowshelf";
    f.gain.value = band.gain;
  } else {
    f.type = "peaking";
    f.gain.value = band.gain;
    f.Q.value = band.Q;
  }
}

export function rebuildHtml5EqChain(graph: Html5AudioGraph, preset: EqPreset): void {
  graph.source.disconnect();
  for (const b of graph.filters) {
    b.disconnect();
  }
  graph.analyser.disconnect();
  graph.filters = [];

  const { ctx, source, analyser } = graph;

  if (preset === "flat") {
    source.connect(analyser);
    analyser.connect(ctx.destination);
    return;
  }

  const bands = EQ_STAGES[preset];
  let last: AudioNode = source;
  for (const band of bands) {
    const f = ctx.createBiquadFilter();
    applyEqBand(f, band);
    last.connect(f);
    last = f;
    graph.filters.push(f);
  }
  last.connect(analyser);
  analyser.connect(ctx.destination);
}

export function teardownHtml5AudioGraph(graph: Html5AudioGraph | null): void {
  if (!graph) {
    return;
  }
  try {
    graph.source.disconnect();
    for (const b of graph.filters) {
      b.disconnect();
    }
    graph.analyser.disconnect();
  } catch {
    /* ignore */
  }
}

/**
 * Wire `audioEl` through EQ + analyser into `audioContext.destination`.
 * Reuses one `MediaElementAudioSourceNode` per element (Web Audio API restriction).
 */
export function setupHtml5AudioGraph(
  audioEl: HTMLAudioElement,
  audioContext: AudioContext,
  preset: EqPreset,
): Html5AudioGraph {
  let graph = graphByAudioElement.get(audioEl);
  if (!graph) {
    const source = audioContext.createMediaElementSource(audioEl);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.35;
    graph = { ctx: audioContext, source, filters: [], analyser };
    graphByAudioElement.set(audioEl, graph);
  }
  rebuildHtml5EqChain(graph, preset);
  return graph;
}
