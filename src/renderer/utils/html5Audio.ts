import type { Howl } from "howler";
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

function acquireSharedAudioContext(): AudioContext {
  const g = globalThis as unknown as { Howler?: { ctx: AudioContext | null } };
  if (g.Howler?.ctx) {
    return g.Howler.ctx;
  }
  const ctx = new AudioContext();
  if (g.Howler) {
    g.Howler.ctx = ctx;
  }
  return ctx;
}

export function setupHtml5AudioGraph(howl: Howl, preset: EqPreset): Html5AudioGraph | null {
  const internals = howl as unknown as { _sounds?: Array<{ _node?: unknown }> };
  const sound = internals._sounds?.[0];
  const audioEl = sound?._node as HTMLAudioElement | undefined;
  if (!audioEl) {
    return null;
  }

  const ctx = acquireSharedAudioContext();

  const source = ctx.createMediaElementSource(audioEl);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.35;

  const graph: Html5AudioGraph = { ctx, source, filters: [], analyser };
  rebuildHtml5EqChain(graph, preset);
  return graph;
}
