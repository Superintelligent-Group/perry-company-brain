# Local LLM Graphiti Model Routing Benchmark

Date: 2026-05-23

## Purpose

This pass measures which local LM Studio model settings work best for Perry's
Graphiti-backed company brain. The target production shape is local semantic
processing on the desktop GPU: Granola notes flow into Perry, Perry keeps fast
SQLite/FTS records for product reads, and Graphiti/Neo4j stores temporal
relationship memory as an async sidecar.

Gemma 4 is treated as the highest-quality local reasoning model. The benchmark
therefore tests whether Gemma should run the whole Graphiti path, or whether
Perry should split responsibilities between a quality model and a structured
extraction model.

## Local Stack

- LM Studio API: `http://127.0.0.1:1234/v1`
- Graphiti bridge: `http://127.0.0.1:8791`
- Neo4j: `bolt://127.0.0.1:7687`
- Embedding model: `text-embedding-nomic-embed-text-v1.5`, 768 dimensions
- Main model target: `gemma-4-e4b-claude-abliterated`
- Structured extraction candidate: `qwen_qwen3-4b-instruct-2507`

## Commands

Fixture quality:

```powershell
$env:PERRY_GRAPHITI_GROUP_ID='bench-name'
pnpm company-brain:evaluate -- --graph true
```

Synthetic company workload:

```powershell
$env:PERRY_GRAPHITI_GROUP_ID='bench-name-synth100'
pnpm company-brain:synthetic -- --count 100 --search-sample 50 --graph true --graph-sample 5
```

Context estimates:

```powershell
lms load gemma-4-e4b-claude-abliterated --context-length 16384 --gpu max --identifier gemma-4-e4b-claude-abliterated --estimate-only
lms load qwen_qwen3-4b-instruct-2507 --context-length 16384 --gpu max --identifier qwen_qwen3-4b-instruct-2507 --estimate-only
```

## Results

| Configuration | Fixture Result | Fixture Time | Synthetic 100 Result | Synthetic Time | Graph Quality |
| --- | --- | ---: | --- | ---: | --- |
| Qwen 4B, 4k | passed clean isolated fixture | 40.94s | passed | 66.28s | 4/5 synthetic graph checks passed; accumulated graph previously hit `n_keep: 4101 >= n_ctx: 4096` |
| Qwen 4B, 8k | passed clean isolated fixture | 41.33s | not rerun in this pass | n/a | 3/3 fixture graph checks passed |
| Qwen 4B, 16k | passed accumulated fixture | 46.70s | passed | 61.43s | 4/5 synthetic graph checks passed; fixed the prior 4k context failure |
| Gemma 4, 8k | jobs drained but graph facts were weak | 49.86s | not run after weak fixture | n/a | 0/3 fixture graph checks passed; extracted only generic relationship facts |
| Gemma 4 main 8k + Qwen small 8k | passed | 47.86s | passed | 64.36s | 3/3 fixture and 5/5 synthetic graph checks passed |
| Gemma 4 main 8k + Qwen small 16k | passed | 44.65s | passed | 78.94s | 3/3 fixture and 5/5 synthetic graph checks passed |

Context estimates:

| Model | Context | Estimated GPU Memory |
| --- | ---: | ---: |
| Gemma 4 | 16,384 | 6.01 GiB |
| Qwen 4B | 16,384 | 3.43 GiB |

The combined Gemma 16k plus Qwen 16k estimate is about 9.44 GiB before
embedding model and runtime overhead. On an RTX 3080-class machine, that is a
tight configuration. Keeping Gemma at 8k and raising the extraction model to
16k is the more practical local setting.

## Interpretation

Gemma 4 should not be judged by the Gemma-only Graphiti result as a general
reasoning model. The failure is more specific: Graphiti's current local
OpenAI-compatible extraction path rewards strict structured-output behavior.
In this stack, Qwen 4B follows that contract more reliably than Gemma 4.

The best product architecture is therefore model routing:

- Gemma 4: final answer synthesis, nuanced meeting summaries, user-facing
  explanations, narrative "what changed and why" responses.
- Qwen 4B with 16k context: Graphiti structured extraction, temporal fact
  ingestion, JSON-shaped sidecar work.
- Nomic embeddings: stable local semantic vectors.
- SQLite/FTS: fast deterministic product reads, admin lists, approvals, search,
  issue and pivot tracking.
- Neo4j/Graphiti: slower temporal relationship memory that enriches answers
  after the base records are already durable.

The 8k hybrid setting was faster on the 100-meeting synthetic pass, but the 16k
small-model setting has better safety margin for accumulated groups. The prior
4k failure was not caused by tiny fixture size; it appeared when Graphiti had
enough existing context in the group to exceed the context window.

## Current Recommendation

Use this local default for the company brain:

```powershell
lms load gemma-4-e4b-claude-abliterated --context-length 8192 --gpu max --identifier gemma-4-e4b-claude-abliterated --ttl 3600 -y
lms load qwen_qwen3-4b-instruct-2507 --context-length 16384 --gpu max --identifier qwen_qwen3-4b-instruct-2507 --ttl 3600 -y
```

Graphiti bridge environment:

```powershell
$env:GRAPHITI_LLM_PROVIDER='lmstudio'
$env:GRAPHITI_OPENAI_BASE_URL='http://127.0.0.1:1234/v1'
$env:GRAPHITI_LLM_MODEL='gemma-4-e4b-claude-abliterated'
$env:GRAPHITI_SMALL_LLM_MODEL='qwen_qwen3-4b-instruct-2507'
$env:GRAPHITI_EMBEDDING_MODEL='text-embedding-nomic-embed-text-v1.5'
$env:GRAPHITI_EMBEDDING_DIM='768'
```

This keeps the best local reasoning model in the path while letting the more
schema-compliant model handle the Graphiti extraction contract.

## Remaining Gaps

- The benchmark scripts should record model name, context length, group id, and
  graph relation counts automatically.
- Graph search checks should be stricter: a false `graphSearchChecks[].passed`
  value should fail quality benchmarks, even if the queue drain succeeds.
- Add a retrieval-quality score that checks exact expected facts, not only
  result counts.
- Add an answer-synthesis benchmark where Gemma receives SQLite plus Graphiti
  context and writes the final Discord/Notion-ready summary.
- Add a long-running accumulated-group soak. The most important failure mode is
  graph context growth over time, not only clean isolated fixtures.
