# Show Me the Model — Session Handoff

## What exists

```
prompts/                  # 10 YAML prompt files (the core IP)
  shared/persona.yaml     # Professor persona + tone guidelines
  shared/taxonomy.yaml    # 12 issue types (IDENTITY_VIOLATION, PARTIAL_EQUILIBRIUM, etc.)
  stage1_decomposition    # Extracts thesis, claims, causal chain, text chunks
  stage2_identities       # GDP identity, balance of payments, S-I, stock-flow
  stage2_general_eq       # Partial vs general equilibrium reasoning
  stage2_exog_endog       # Assumed outcomes vs derived from primitives
  stage2_quantitative     # Magnitudes, empirical plausibility
  stage2_consistency      # Internal contradictions
  stage2_steelman         # What the essay gets right (dedicated positive pass)
  stage2_5_dedup          # Merges overlapping annotations across passes
  stage3_synthesis        # Opus synthesis report (bottom line, assumptions, rigorous alt.)

backend/
  prompt_loader.py        # Loads YAML, resolves {{ persona }}/{{ tone_guidelines }} from shared/,
                          #   templates in runtime vars (source_text, decomposition, etc.)
  pipeline.py             # Async orchestrator: Stage 1 → Stage 2 (batched) → 2.5 → 3
                          #   Includes JSON retry (asks model to fix its own malformed output)
                          #   Rate-limited batching (2 concurrent Stage 2 calls to stay under 30k TPM)

eval/
  gold-standard/          # 3 hand-written gold standards (citrini.md, pettis.md, cass.md)
  source-texts/           # Raw .txt source texts for each
  eval_runner.py          # CLI: python -m eval.eval_runner --source pettis --stage 2 --resume
  outputs/                # Timestamped JSON outputs per run (gitignored)
```

## Pipeline architecture

```
Source text
    │
    ▼
Stage 1: Decomposition (Sonnet) ─── 1 call
    │
    ▼
Stage 2: 6 parallel analysis passes (Sonnet) ─── 6 calls, batched 2 at a time
    │  identities, general_eq, exog_endog, quantitative, consistency, steelman
    │
    ▼
Stage 2.5: Dedup & merge (Sonnet) ─── 1 call
    │  Merges overlapping annotations, orders by importance, passes through strengths
    │
    ▼
Stage 3: Synthesis (Opus) ─── 1 call
    Produces: central_claim, key_assumptions, internal_consistency,
              what_essay_gets_right, rigorous_alternative, bottom_line
```

## Eval results (Feb 24, 2026)

| Source  | Gold Std | Pipeline | Coverage |
|---------|----------|----------|----------|
| Pettis  | 6        | 11       | 6/6      |
| Citrini | 11       | 12       | 10/11    |
| Cass    | 8        | 11       | 8/8      |

Outputs saved in `eval/outputs/{source}/{timestamp}/stage{1,2,2_5,3}.json`.

## Design decisions made

- **Severity**: Critical / Moderate / Minor only (no Note or Positive tags)
- **Steelman**: Dedicated 6th pass (not per-pass positives)
- **Dedup**: Post-Stage-2 merge step (Sonnet call between Stage 2 and Stage 3)
- **Annotation anchoring**: Quoted passage only (front-end does fuzzy matching)
- **Few-shot examples**: Drawn from gold standards, embedded in each pass's YAML

## Known issues / tech debt

- Stage 1 decomposition can hit max_tokens on long texts (bumped to 16k, may need more for 10k+ word essays)
- JSON repair heuristic works but is fragile — the retry-with-correction-prompt approach is more reliable
- Rate limit batching is hardcoded at 2 concurrent / 5s delay — should be configurable or adaptive
- No `shared/few_shot_examples.yaml` library file (examples are inlined in each pass YAML)
- Eval runner saves outputs but has no automated comparison/scoring against gold standards yet

## What to build next (Phase 1 from the plan)

1. **Prompt tuning** — Review specific annotations from all 3 runs in detail. Look for:
   - Annotations that are too vague or too generic vs gold standard
   - Places where the pipeline finds issues the gold standard missed (validate or suppress)
   - Dig Deeper sections: are they adding value or just padding?

2. **FastAPI backend** — `backend/main.py` with `/analyze` endpoint
   - Accept text, URL, or PDF upload
   - BYOK: API key in request header, never stored
   - Text extractors: `trafilatura` for URLs, `pymupdf` for PDFs
   - Return structured JSON (decomposition + annotations + synthesis)

3. **Frontend** — HTML + Tailwind + vanilla JS
   - Landing page with input form (paste text / upload PDF / enter URL)
   - Two-pane annotation view (original text left, annotations right)
   - Collapsible Dig Deeper sections
   - Synthesis report below
   - Progress indicators per stage

## How to run

```bash
cp .env.example .env  # add your ANTHROPIC_API_KEY
pip install -r requirements.txt

# Full pipeline on one source:
python -m eval.eval_runner --source pettis

# Just Stage 1:
python -m eval.eval_runner --source citrini --stage 1

# Resume from last run:
python -m eval.eval_runner --source citrini --resume
```
