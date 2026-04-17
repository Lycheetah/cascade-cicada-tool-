/**
 * CASCADE AI Scoring — DeepSeek BYOK
 * Scores against real Codex framework essentials.
 * Framework score is LOCKED — sovereign score stays with the user.
 */

import { buildFrameworkContext } from './frameworks.js'

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
const MODEL = 'deepseek-chat'

function getKey() {
  return localStorage.getItem('cascade_deepseek_key') || ''
}

async function chat(systemPrompt, userPrompt, maxTokens = 1200) {
  const key = getKey()
  if (!key) throw new Error('No DeepSeek API key. Add one in Settings.')

  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`DeepSeek error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.choices[0].message.content.trim()
}

/**
 * Paradoxical Truth Seek — Vector Inversion Protocol
 * Hold two opposing truths. Find the scale at which both hold simultaneously.
 * Returns synthesis + SRS + σ(I) + recommended AXIOM.
 */
export async function paradoxSeek(claimA, claimB, context = '') {
  const system = `You are a CASCADE paradox analyst operating the Vector Inversion Protocol from the AURA Self-Upgrade Engine.

Your task: hold two opposing truths simultaneously. Do NOT resolve the paradox by choosing a side. Find the scale — the level of abstraction, scope, or frame — at which BOTH claims are simultaneously true.

This is the core mechanic: paradox held, not solved, becomes a higher-order truth.

Output format — return ONLY valid JSON:
{
  "vector_a_pressure": <integer 1-100, how much truth-pressure Claim A carries>,
  "vector_b_pressure": <integer 1-100, how much truth-pressure Claim B carries>,
  "tension": "<one sentence: what is the actual contradiction between them>",
  "inversion_scale": "<the frame/scale/dimension at which both are simultaneously true>",
  "synthesis": "<2-3 sentences: the higher-order truth that holds both — this is the upgrade>",
  "axiom": "<one sentence: the irreducible core claim of the synthesis>",
  "srs": <float 0.00-1.00, Symbiotic Resonance Score — how strongly the synthesis resolves the tension>,
  "sigma_i": <float 0.00-0.20, Integrity Variance — lower is better, <0.04 means upgrade confirmed>,
  "upgrade_confirmed": <boolean — true if srs >= 0.75 AND sigma_i < 0.04>,
  "recommended_layers": {
    "AXIOM": <integer score 1-100>,
    "FOUNDATION": <integer score 1-100>,
    "STRUCTURE": <integer score 1-100>,
    "COHERENCE": <integer score 1-100>,
    "RESONANCE": <integer score 1-100>
  }
}

Be honest. A weak synthesis scores low SRS. A forced resolution scores high σ(I). The upgrade is only confirmed when it genuinely holds.`

  const user = `Claim A: ${claimA}

Claim B: ${claimB}

${context ? `Context:\n${context}` : ''}

Run the Vector Inversion Protocol. Find the scale at which both are true. Return JSON only.`

  const raw = await chat(system, user, 1000)
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON object')
    return JSON.parse(match[0])
  } catch {
    throw new Error('AI returned unexpected format. Try again.')
  }
}

/**
 * Multi-block synthesis — up to 10 selected blocks, one emergent truth.
 */
export async function synthesizeBlocks(blocks) {
  const system = `You are a CASCADE multi-block synthesis engine.

You receive up to 10 knowledge blocks selected by a researcher. Your task: find the single emergent truth that arises from holding all of them simultaneously — the truth that none of them contains alone but which becomes visible when all are held together.

Cap your analysis at what the blocks actually contain. Do not inflate or speculate beyond their content.

Output format — return ONLY valid JSON:
{
  "emergent_title": "<5-10 word title for the emergent truth>",
  "core_emergence": "<one sentence: the truth only visible when all blocks are held together>",
  "synthesis": "<3-5 sentences: the full emergent truth>",
  "key_pattern": "<one sentence: the underlying pattern connecting all blocks>",
  "strongest_signal": "<title of the block carrying the most epistemic weight>",
  "outlier": "<title of the block most in tension with the others, or null if none>",
  "coherence": <integer 1-100, how strongly these blocks synthesize>,
  "axiom": "<one sentence: the irreducible core claim of the synthesis>"
}`

  const blockList = blocks
    .slice(0, 10)
    .map((b, i) => `${i + 1}. [${b.score_aggregate || '—'}] ${b.title}${b.content ? ': ' + b.content.slice(0, 200) : ''}`)
    .join('\n')

  const user = `${blocks.length} selected blocks:

${blockList}

Find the emergent truth. Return JSON only.`

  const raw = await chat(system, user, 900)
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON object')
    return JSON.parse(match[0])
  } catch {
    throw new Error('AI returned unexpected format. Try again.')
  }
}

/**
 * Cross-file synthesis — 2 to 10 files, emergent truth from their intersection.
 * files: array of { name, blocks }
 */
export async function crossSynthesize(files) {
  const system = `You are a CASCADE cross-reference synthesis engine.

You receive ${files.length} sets of knowledge blocks from different files. Your task: find the truth that exists at their collective intersection — the truth that none of the files contains alone, but which only becomes visible when all are held simultaneously.

This is not a merger or summary. It is the truth that ARISES BETWEEN them.

Output format — return ONLY valid JSON:
{
  "intersection_title": "<5-10 word title for the emergent truth>",
  "core_emergence": "<one sentence: the truth only visible when all files are held together>",
  "synthesis": "<3-5 sentences: the cross-reference truth in full>",
  "resonance_points": ["<shared pattern across files>", "<second resonance>"],
  "tension_points": ["<genuine conflict between files>"],
  "file_contributions": [{"file": "<name>", "contribution": "<one sentence>"}],
  "cross_coherence": <integer 1-100>,
  "axiom": "<one sentence: irreducible core claim of the emergent truth>"
}`

  const formatFile = ({ name, blocks }) => {
    const top = blocks
      .filter(b => b.score_aggregate > 0 || b.content)
      .sort((a, b) => (b.score_aggregate || 0) - (a.score_aggregate || 0))
      .slice(0, 8)
      .map(b => `  [${b.score_aggregate || '—'}] ${b.title}${b.content ? ': ' + b.content.slice(0, 120) : ''}`)
      .join('\n')
    return `File: "${name}"\n${top}`
  }

  const user = files.map(formatFile).join('\n\n') + '\n\nFind the truth that arises at the intersection of all these files. Return JSON only.'

  const raw = await chat(system, user, 1200)
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON object')
    return JSON.parse(match[0])
  } catch {
    throw new Error('AI returned unexpected format. Try again.')
  }
}

/**
 * Synthesize all scored blocks in a pyramid into a unified truth statement.
 */
export async function synthesizePyramid(pyramidName, blocks) {
  const system = `You are a CASCADE synthesis engine. You receive a set of scored knowledge blocks from a knowledge pyramid and produce a unified synthesis — the highest-order truth that holds all the blocks together.

This is not a summary. A summary lists. A synthesis reveals the deeper structure underneath.

Output format — return ONLY valid JSON:
{
  "synthesis_title": "<5-10 word title for the unified truth>",
  "core_claim": "<one sentence: the irreducible truth that all blocks point toward>",
  "synthesis": "<3-5 sentences: the unified truth statement that holds all blocks together>",
  "key_tensions": ["<tension 1>", "<tension 2>"],
  "strongest_block": "<title of the highest-epistemic-weight block>",
  "weakest_link": "<title of the block most at risk of pulling the pyramid apart>",
  "pyramid_coherence": <integer 1-100, overall coherence of the pyramid as a unified whole>,
  "recommended_next": "<one sentence: what knowledge would most strengthen this pyramid>"
}`

  const blockSummary = blocks
    .filter(b => b.score_aggregate > 0)
    .sort((a, b) => b.score_aggregate - a.score_aggregate)
    .map(b => `[${b.score_aggregate}] ${b.title}${b.content ? ': ' + b.content.slice(0, 200) : ''}`)
    .join('\n')

  const user = `Pyramid: "${pyramidName}"

Scored blocks (score · title · content excerpt):
${blockSummary}

Synthesize these into the unified truth they collectively point toward. Return JSON only.`

  const raw = await chat(system, user, 1000)
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON object')
    return JSON.parse(match[0])
  } catch {
    throw new Error('AI returned unexpected format. Try again.')
  }
}

/**
 * Suggest blocks from file content.
 */
export async function suggestBlocks(fileContent, fileName) {
  const system = `You are a CASCADE knowledge analyst. Extract the most epistemically significant claims from documents. These become blocks in a knowledge pyramid scored for truth pressure.`

  const user = `Document: "${fileName}"

Extract up to 9 epistemically significant claims as knowledge blocks.

Return ONLY a JSON array. Each object:
- "title": 5-10 word claim title
- "content": 1-2 sentences describing the claim

No preamble. JSON only.

Content:
${fileContent.slice(0, 4000)}`

  const raw = await chat(system, user, 800)
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('No JSON array')
    return JSON.parse(match[0])
  } catch {
    throw new Error('AI returned unexpected format. Try again.')
  }
}

/**
 * Score all 9 onion layers against selected framework essentials.
 * Returns array of { layer_name, framework_score, framework_reasoning }
 *
 * The framework essentials ARE the scoring reference — not a generic AI guess.
 * This score is LOCKED after generation. Framework integrity preserved.
 */
export async function scoreBlock(blockTitle, blockContent, fileContent, frameworkIds = ['cascade']) {
  const frameworkContext = buildFrameworkContext(frameworkIds)

  const system = `You are a CASCADE epistemic scoring system operating as a framework evaluator.

You score knowledge blocks against the following framework specifications. These are the TRUTH PRESSURE REFERENCES — real documents from the Lycheetah Framework Codex. Score strictly against these frameworks. Do not invent criteria.

${frameworkContext}

---

ONION LAYERS (9 total, scored innermost to outermost):
0. AXIOM       — The irreducible core claim. If this fails, the block fails.
1. FOUNDATION  — Primary supporting evidence.
2. STRUCTURE   — Logical architecture connecting claim to evidence.
3. COHERENCE   — Internal consistency. Does the block contradict itself?
4. RESONANCE   — Connections to other known truths.
5. TENSION     — Where the claim meets genuine friction.
6. CONTESTED   — Active dispute zone. What others challenge.
7. SPECULATIVE — Beyond current proof.
8. FRONTIER    — The unknown edge.

SCORING RULES:
- Range: 1–100 calibrated | 101–999 for abstract new truths beyond verification
- Score each layer based on how strongly the claim holds AT THAT LAYER specifically
- AXIOM score is the anchor — no block should score much higher than its AXIOM
- Be honest. Weak axioms score low. Contested claims score low at CONTESTED.
- Do NOT inflate scores. Framework integrity depends on honest scoring.`

  const user = `Score this block against the framework(s) above.

Block title: ${blockTitle}
Block content: ${blockContent || '(no additional content)'}

Source document excerpt:
${(fileContent || '').slice(0, 1500)}

Return ONLY a JSON array of exactly 9 objects in layer order (AXIOM first):
{ "layer_name": string, "framework_score": integer, "framework_reasoning": string (one sentence) }

JSON only. No preamble.`

  const raw = await chat(system, user, 1400)
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('No JSON array')
    const scored = JSON.parse(match[0])
    if (scored.length !== 9) throw new Error('Expected 9 layers')
    return scored.map(s => ({
      layer_name: s.layer_name,
      framework_score: Math.min(Math.max(Number(s.framework_score) || 0, 0), 999),
      framework_reasoning: s.framework_reasoning || '',
    }))
  } catch {
    throw new Error('AI returned unexpected format. Try again.')
  }
}
