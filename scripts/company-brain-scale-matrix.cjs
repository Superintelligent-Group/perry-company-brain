const { spawnSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const args = parseArgs(process.argv.slice(2));
const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
const outDir = args.outDir || join("reports", "scale", stamp);
const seed = Number(args.seed || 101);
const volumeCounts = parseNumberList(args["volume-counts"] || "1000,10000");
const arcSpecs = parseArcSpecs(args.arcs || "10x8,25x8");
const arcOrders = parseStringList(args.orders || "chronological,shuffle");
const duplicateReplay = Math.max(0, Number(args["duplicate-replay"] || 10));
const graphEnabled = args.graph === "true";
const graphLimit = Math.max(0, Number(args["graph-limit"] || 6));
const searchSampleCap = Math.max(1, Number(args["search-sample-cap"] || 1000));

mkdirSync(outDir, { recursive: true });

main();

function main() {
  const started = performance.now();
  const runs = [];

  if (args["skip-volume"] !== "true") {
    for (const count of volumeCounts) {
      const searchSample = Math.min(searchSampleCap, count);
      runs.push(runStep({
        kind: "volume",
        name: `volume-${count}`,
        commandArgs: [
          "scripts/company-brain-synthetic.cjs",
          "--count", String(count),
          "--search-sample", String(searchSample),
          "--seed", String(seed),
          "--graph", "false",
        ],
      }));
    }
  }

  if (args["skip-arcs"] !== "true") {
    for (const spec of arcSpecs) {
      for (const order of arcOrders) {
        runs.push(runStep({
          kind: "arcs",
          name: `arcs-${spec.projects}x${spec.meetingsPerProject}-${order}`,
          commandArgs: [
            "scripts/company-brain-arcs.cjs",
            "--projects", String(spec.projects),
            "--meetings-per-project", String(spec.meetingsPerProject),
            "--order", order,
            "--duplicate-replay", String(duplicateReplay),
            "--seed", String(seed),
            "--graph", graphEnabled ? "true" : "false",
            "--graph-limit", String(graphLimit),
          ],
        }));
      }
    }
  }

  const summary = summarizeRuns(runs, performance.now() - started);
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(join(outDir, "summary.md"), renderMarkdown(summary), "utf8");
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 2;
}

function runStep(step) {
  const started = performance.now();
  const jsonPath = join(outDir, `${step.name}.json`);
  const stdoutPath = join(outDir, `${step.name}.stdout.log`);
  const stderrPath = join(outDir, `${step.name}.stderr.log`);
  console.log(`RUN ${step.name}: node ${step.commandArgs.join(" ")}`);
  const result = spawnSync(process.execPath, step.commandArgs, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PERRY_SQLITE_JOURNAL_MODE: process.env.PERRY_SQLITE_JOURNAL_MODE || "MEMORY",
      PERRY_GRAPHITI_BRIDGE_URL: process.env.PERRY_GRAPHITI_BRIDGE_URL || "http://127.0.0.1:8791",
      PERRY_GRAPHITI_DIRECT_CHANGESETS: process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS || "true",
      PERRY_GRAPHITI_TIMEOUT_MS: process.env.PERRY_GRAPHITI_TIMEOUT_MS || "120000",
    },
    encoding: "utf8",
    windowsHide: true,
  });
  const spawnError = result.error ? `${result.error.name || "Error"}: ${result.error.message || String(result.error)}` : undefined;
  writeFileSync(stdoutPath, result.stdout || "", "utf8");
  writeFileSync(stderrPath, [result.stderr || "", spawnError ? `spawnError=${spawnError}` : ""].filter(Boolean).join("\n"), "utf8");
  const parsed = parseJsonFromStdout(result.stdout || "");
  if (parsed) writeFileSync(jsonPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  return {
    kind: step.kind,
    name: step.name,
    ok: result.status === 0 && parsed?.ok !== false,
    status: result.status,
    signal: result.signal || undefined,
    error: spawnError,
    elapsedMs,
    jsonPath: parsed ? jsonPath : undefined,
    stdoutPath,
    stderrPath,
    metrics: parsed ? extractMetrics(step.kind, parsed) : undefined,
    failureSummary: parsed?.failureSummary || summarizeFailureList(parsed?.failures),
    sampleFailures: parsed?.sampleFailures || parsed?.failures?.slice?.(0, 10) || [],
  };
}

function extractMetrics(kind, output) {
  if (kind === "volume") {
    return {
      count: output.config?.count,
      elapsedMs: output.elapsedMs,
      throughputMeetingsPerSecond: output.throughputMeetingsPerSecond,
      processedMeetings: output.brain?.processedMeetings,
      decisions: output.brain?.decisions,
      actionItems: output.brain?.actionItems,
      decisionPassRate: output.brain?.decisionPassRate,
      actionPassRate: output.brain?.actionPassRate,
      searchPassRate: output.brain?.searchPassRate,
      ownershipChanges: output.insights?.counts?.ownershipChanges,
      users: output.multiplayer?.users,
      issues: output.multiplayer?.issues,
      pivots: output.multiplayer?.pivots,
    };
  }
  return {
    count: output.config?.count,
    projects: output.config?.projects,
    meetingsPerProject: output.config?.meetingsPerProject,
    order: output.config?.processOrder,
    duplicateReplay: output.config?.duplicateReplay,
    processedMeetings: output.brain?.processedMeetings,
    decisionPassRate: output.brain?.decisionPassRate,
    actionPassRate: output.brain?.actionPassRate,
    searchPassRate: output.brain?.searchPassRate,
    ownershipPassRate: output.brain?.ownershipPassRate,
    duplicateReplayPassRate: output.brain?.duplicateReplayPassRate,
    ownershipChanges: output.brain?.ownershipChanges,
    ingestP50Ms: output.latency?.ingestMs?.p50,
    ingestP95Ms: output.latency?.ingestMs?.p95,
    searchP50Ms: output.latency?.searchMs?.p50,
    searchP95Ms: output.latency?.searchMs?.p95,
    graphDrainMs: output.latency?.graphDrainMs,
    graphSearchP50Ms: output.latency?.graphSearchMs?.p50,
  };
}

function summarizeRuns(runs, elapsedMs) {
  const ok = runs.every((run) => run.ok);
  return {
    ok,
    elapsedMs: round(elapsedMs),
    outDir,
    config: {
      seed,
      volumeCounts,
      arcSpecs,
      arcOrders,
      duplicateReplay,
      graphEnabled,
      graphLimit,
      searchSampleCap,
    },
    runs,
    rollups: {
      volume: summarizeVolume(runs.filter((run) => run.kind === "volume")),
      arcs: summarizeArcs(runs.filter((run) => run.kind === "arcs")),
    },
  };
}

function summarizeVolume(runs) {
  return runs.map((run) => ({ name: run.name, ok: run.ok, ...run.metrics }));
}

function summarizeArcs(runs) {
  return runs.map((run) => ({ name: run.name, ok: run.ok, ...run.metrics }));
}

function renderMarkdown(summary) {
  const lines = [
    "# Company Brain Scale Matrix",
    "",
    `- OK: ${summary.ok}`,
    `- Elapsed: ${summary.elapsedMs} ms`,
    `- Output: ${summary.outDir}`,
    `- Graph enabled: ${summary.config.graphEnabled}`,
    "",
    "## Volume Runs",
    "",
    ...(summary.rollups.volume.length ? summary.rollups.volume.map((run) => `- ${run.name}: ok=${run.ok}, meetings=${run.processedMeetings}, throughput=${run.throughputMeetingsPerSecond}/s, search=${run.searchPassRate}, decisions=${run.decisions}, actions=${run.actionItems}`) : ["- skipped"]),
    "",
    "## Temporal Arc Runs",
    "",
    ...(summary.rollups.arcs.length ? summary.rollups.arcs.map((run) => `- ${run.name}: ok=${run.ok}, meetings=${run.processedMeetings}, order=${run.order}, ownership=${run.ownershipPassRate}, duplicateReplay=${run.duplicateReplayPassRate}, ingestP50=${run.ingestP50Ms}ms, searchP50=${run.searchP50Ms}ms`) : ["- skipped"]),
    "",
    "## Failures",
    "",
    ...(summary.runs.filter((run) => !run.ok).length ? summary.runs.filter((run) => !run.ok).map((run) => `- ${run.name}: ${JSON.stringify(run.failureSummary || run.sampleFailures)}`) : ["- none"]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function parseJsonFromStdout(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return undefined;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function summarizeFailureList(failures) {
  if (!Array.isArray(failures)) return undefined;
  return failures.reduce((acc, item) => {
    const key = typeof item === "string" ? item.split(":", 1)[0] : item?.type || "failure";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function parseNumberList(value) {
  return parseStringList(value).map((item) => Math.max(1, Number(item))).filter((item) => Number.isFinite(item));
}

function parseArcSpecs(value) {
  return parseStringList(value).map((item) => {
    const match = item.match(/^(\d+)x(\d+)$/u);
    if (!match) throw new Error(`Invalid arc spec '${item}', expected PROJECTSxMEETINGS such as 25x8`);
    return { projects: Number(match[1]), meetingsPerProject: Number(match[2]) };
  });
}

function parseStringList(value) {
  return String(value || "").split(/,/u).map((item) => item.trim()).filter(Boolean);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = "true";
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}