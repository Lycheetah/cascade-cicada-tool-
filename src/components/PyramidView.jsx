import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  computeBlockScore, computeFileScore, getScoreBand,
  computePi, checkLayerDependencies, detectTensions,
  detectCascadeEvent, getTruthVelocity,
} from '../scoring/cascade'
import { suggestBlocks, scoreBlock, synthesizePyramid, crossSynthesize, synthesizeBlocks } from '../scoring/ai'
import { FRAMEWORK_LIST } from '../scoring/frameworks'
import OnionEditor from './OnionEditor'
import PyramidViz from './PyramidViz'
import OnionRing from './OnionRing'
import './PyramidView.css'

const SCORE_MODES = ['framework', 'sovereign', 'composite']
const MAX_FILE_BYTES = 500 * 1024 // 500 KB
const WARN_FILE_BYTES = 100 * 1024 // 100 KB

function fmtTime(ts) {
  if (!ts) return null
  const d = new Date(ts * 1000)
  const now = Date.now() / 1000
  const diff = now - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  return d.toLocaleDateString()
}

function fmtBytes(n) {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

export default function PyramidView({ pyramid, onBack }) {
  const [files, setFiles] = useState([])
  const [activeFile, setActiveFile] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [activeBlock, setActiveBlock] = useState(null)
  const [layers, setLayers] = useState([])
  const [addingFile, setAddingFile] = useState(false)
  const [addingBlock, setAddingBlock] = useState(false)
  const [fileName, setFileName] = useState('')
  const [blockTitle, setBlockTitle] = useState('')
  const [blockFrameworks] = useState(['cascade'])
  const [dragging, setDragging] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [rescoring, setRescoring] = useState(false)
  const [aiError, setAiError] = useState('')
  const [scoreMode, setScoreMode] = useState(pyramid.score_display_mode || 'framework')
  const [view, setView] = useState('blocks')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [exportMsg, setExportMsg] = useState('')
  const [freshlyScored, setFreshlyScored] = useState(new Set()) // block IDs that just got scored
  const [cascadeEvents, setCascadeEvents] = useState([])
  const [tensions, setTensions] = useState([])
  const [apiCalls, setApiCalls] = useState(0)
  const [saveIndicator, setSaveIndicator] = useState(false)
  const [editingNotes, setEditingNotes] = useState(null) // block id
  const [notesValue, setNotesValue] = useState('')
  const [uploadWarning, setUploadWarning] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [showCascadeLog, setShowCascadeLog] = useState(false)
  const [showTensions, setShowTensions] = useState(false)
  const [expandedBlocks, setExpandedBlocks] = useState(new Set())
  const [scoringAll, setScoringAll] = useState(false)
  const [scoreAllProgress, setScoreAllProgress] = useState('')
  const [synthesizing, setSynthesizing] = useState(false)
  const [synthesis, setSynthesis] = useState(null)
  const [showSynthesis, setShowSynthesis] = useState(false)
  const [crossFileIds, setCrossFileIds] = useState(new Set())
  const [crossSynthesizing, setCrossSynthesizing] = useState(false)
  const [crossResult, setCrossResult] = useState(null)
  const [showCrossResult, setShowCrossResult] = useState(false)

  function toggleCrossFile(id) {
    setCrossFileIds(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.size < 10 ? n.add(id) : null
      return n
    })
  }
  const [blockSynthesizing, setBlockSynthesizing] = useState(false)
  const [blockSynthResult, setBlockSynthResult] = useState(null)
  const [showBlockSynth, setShowBlockSynth] = useState(false)
  const dropRef = useRef(null)

  function toggleExpand(e, id) {
    e.stopPropagation()
    setExpandedBlocks(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  useEffect(() => { loadFiles() }, [pyramid.id])
  useEffect(() => { if (activeFile) loadBlocks(activeFile.id) }, [activeFile])
  useEffect(() => { if (activeBlock) loadLayers(activeBlock.id) }, [activeBlock])

  // Auto-detect tensions when blocks change
  useEffect(() => {
    if (blocks.length > 1) setTensions(detectTensions(blocks))
  }, [blocks])

  function flashSave() {
    setSaveIndicator(true)
    setTimeout(() => setSaveIndicator(false), 1200)
  }

  function markFreshlyScored(id) {
    setFreshlyScored(s => new Set(s).add(id))
    setTimeout(() => setFreshlyScored(s => { const n = new Set(s); n.delete(id); return n }), 3000)
  }

  function trackApiCall() {
    setApiCalls(n => n + 1)
  }

  async function loadFiles() {
    const list = await window.cascade.files.list(pyramid.id)
    setFiles(list)
    if (list.length > 0 && !activeFile) setActiveFile(list[0])
  }

  async function loadBlocks(fileId) {
    const list = await window.cascade.blocks.list(fileId)
    setBlocks(sortBlocks(list))
  }

  function sortBlocks(list) {
    return [...list].sort((a, b) => {
      const sa = a.score_aggregate || 0
      const sb = b.score_aggregate || 0
      if (sa === 0 && sb === 0) return a.position - b.position
      if (sa === 0) return 1
      if (sb === 0) return -1
      return sb - sa
    })
  }

  async function loadLayers(blockId) {
    const list = await window.cascade.onion.list(blockId)
    setLayers(list)
  }

  async function createFile() {
    if (!fileName.trim()) return
    const file = await window.cascade.files.create({ pyramidId: pyramid.id, name: fileName.trim(), content: '' })
    setFileName('')
    flashSave()
    await loadFiles(); setActiveFile(file)
  }

  async function createFileFromDrop(name, content, size) {
    if (size > MAX_FILE_BYTES) {
      setUploadWarning(`${name} exceeds 500KB limit (${fmtBytes(size)}) — skipped.`)
      setTimeout(() => setUploadWarning(''), 4000)
      return
    }
    let finalContent = content
    if (size > WARN_FILE_BYTES) {
      setUploadWarning(`${name} is large (${fmtBytes(size)}) — using first 100KB for AI context.`)
      setTimeout(() => setUploadWarning(''), 4000)
      finalContent = content.slice(0, WARN_FILE_BYTES)
    }
    const file = await window.cascade.files.create({ pyramidId: pyramid.id, name, content: finalContent })
    flashSave()
    await loadFiles(); setActiveFile(file)
  }

  async function deleteFile(e, id) {
    e.stopPropagation()
    if (!confirm('Delete this file and all its blocks?')) return
    await window.cascade.files.delete(id)
    setActiveFile(null); setBlocks([]); setActiveBlock(null)
    flashSave()
    loadFiles()
  }

  async function createBlock(title, content, fwRefs) {
    if (!title?.trim() || !activeFile) return null
    const block = await window.cascade.blocks.create({
      fileId: activeFile.id, pyramidId: pyramid.id,
      title: title.trim(), content: content?.trim() || '',
      position: blocks.length, frameworkRefs: fwRefs || blockFrameworks,
    })
    setBlockTitle('')
    flashSave()
    await loadBlocks(activeFile.id)
    setActiveBlock(block)
    return block
  }

  async function deleteBlock(e, id) {
    e.stopPropagation()
    if (!confirm('Delete this block?')) return
    await window.cascade.blocks.delete(id)
    if (activeBlock?.id === id) { setActiveBlock(null); setLayers([]) }
    setSelected(s => { const n = new Set(s); n.delete(id); return n })
    flashSave()
    loadBlocks(activeFile.id)
  }

  async function duplicateBlock(e, id) {
    e.stopPropagation()
    const newBlock = await window.cascade.blocks.duplicate(id)
    if (newBlock) {
      flashSave()
      await loadBlocks(activeFile.id)
      setActiveBlock(newBlock)
    }
  }

  async function moveBlock(id, dir) {
    const idx = blocks.findIndex(b => b.id === id)
    if (dir === -1 && idx === 0) return
    if (dir === 1 && idx === blocks.length - 1) return
    const swapIdx = idx + dir
    const a = blocks[idx], b = blocks[swapIdx]
    await window.cascade.blocks.updateScore({ id: a.id, score: a.score_aggregate })
    await window.cascade.blocks.updateScore({ id: b.id, score: b.score_aggregate })
    const newBlocks = [...blocks]
    newBlocks[idx] = { ...b, position: idx }
    newBlocks[swapIdx] = { ...a, position: swapIdx }
    setBlocks(newBlocks)
  }

  async function onLayerSaved() {
    if (!activeBlock || !activeFile) return
    const allLayers = await window.cascade.onion.list(activeBlock.id)
    setLayers(allLayers)
    const oldScore = activeBlock.score_aggregate || 0
    const fwScore = computeBlockScore(allLayers, 'framework')
    const svScore = computeBlockScore(allLayers, 'sovereign')
    await window.cascade.blocks.updateScore({ id: activeBlock.id, score: fwScore, sovereignScore: svScore, scoredAt: Math.floor(Date.now() / 1000) })
    markFreshlyScored(activeBlock.id)

    // Cascade event detection
    const allBlocks = await window.cascade.blocks.list(activeFile.id)
    const event = detectCascadeEvent(activeBlock.id, oldScore, fwScore, allBlocks)
    if (event) {
      setCascadeEvents(prev => [{ ...event, timestamp: Date.now() }, ...prev].slice(0, 20))
    }

    setBlocks(sortBlocks(allBlocks))
    const fileScore = computeFileScore(allBlocks, 'framework')
    await window.cascade.files.updateScore({ id: activeFile.id, score: fileScore })
    flashSave()
  }

  // Notes
  async function saveNotes(blockId) {
    await window.cascade.blocks.updateNotes({ id: blockId, notes: notesValue })
    setBlocks(prev => sortBlocks(prev.map(b => b.id === blockId ? { ...b, notes: notesValue } : b)))
    setEditingNotes(null)
    flashSave()
  }

  // Drag & drop
  function onDragOver(e) { e.preventDefault(); setDragging(true) }
  function onDragLeave() { setDragging(false) }
  function onDrop(e) {
    e.preventDefault(); setDragging(false)
    Array.from(e.dataTransfer.files).forEach(file => {
      if (!file.name.match(/\.(txt|md|markdown|json|csv)$/i)) return
      const reader = new FileReader()
      reader.onload = (ev) => createFileFromDrop(file.name, ev.target.result, file.size)
      reader.readAsText(file)
    })
  }

  // AI: synthesize all scored blocks into unified truth
  async function handleSynthesize() {
    setSynthesizing(true); setAiError('')
    try {
      // Gather all blocks across all files
      let allBlocks = []
      for (const file of files) {
        const fileBlocks = await window.cascade.blocks.list(file.id)
        allBlocks = allBlocks.concat(fileBlocks)
      }
      const scored = allBlocks.filter(b => b.score_aggregate > 0)
      if (scored.length === 0) { setAiError('No scored blocks to synthesize.'); setSynthesizing(false); return }
      trackApiCall()
      const result = await synthesizePyramid(pyramid.name, scored)
      setSynthesis(result)
      setShowSynthesis(true)
    } catch (e) { setAiError(e.message) }
    setSynthesizing(false)
  }

  // AI: synthesize selected blocks (2–10)
  async function handleSynthesizeBlocks() {
    if (selectedBlocks.length < 2 || selectedBlocks.length > 10) return
    setBlockSynthesizing(true); setAiError(''); setBlockSynthResult(null)
    try {
      trackApiCall()
      const result = await synthesizeBlocks(selectedBlocks)
      setBlockSynthResult(result)
      setShowBlockSynth(true)
    } catch (e) { setAiError(e.message) }
    setBlockSynthesizing(false)
  }

  // AI: cross-synthesize multiple files
  async function handleCrossSynthesize() {
    if (crossFileIds.size < 2) return
    setCrossSynthesizing(true); setAiError(''); setCrossResult(null)
    try {
      const selectedFiles = files.filter(f => crossFileIds.has(f.id))
      const filesWithBlocks = await Promise.all(
        selectedFiles.map(async f => ({
          name: f.name,
          blocks: await window.cascade.blocks.list(f.id),
        }))
      )
      trackApiCall()
      const result = await crossSynthesize(filesWithBlocks)
      setCrossResult({ ...result, fileNames: selectedFiles.map(f => f.name) })
      setShowCrossResult(true)
    } catch (e) { setAiError(e.message) }
    setCrossSynthesizing(false)
  }

  // AI: suggest blocks
  async function handleSuggestBlocks() {
    if (!activeFile) return
    setSuggesting(true); setAiError('')
    try {
      trackApiCall()
      const suggestions = await suggestBlocks(activeFile.content || '', activeFile.name)
      for (const s of suggestions) await createBlock(s.title, s.content, blockFrameworks)
      await loadBlocks(activeFile.id)
    } catch (e) { setAiError(e.message) }
    setSuggesting(false)
  }

  // AI: full pipeline across ALL files — extract blocks if missing, then score everything
  async function handleScoreAllFiles() {
    if (files.length === 0) return
    setScoringAll(true); setAiError('')
    try {
      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi]
        let fileBlocks = await window.cascade.blocks.list(file.id)

        // Step 1: if file has content but no blocks, extract them first
        if (fileBlocks.length === 0 && file.content?.trim()) {
          setScoreAllProgress(`File ${fi + 1}/${files.length} · Extracting blocks…`)
          trackApiCall()
          const suggestions = await suggestBlocks(file.content, file.name)
          for (const s of suggestions) {
            await window.cascade.blocks.create({
              fileId: file.id, pyramidId: pyramid.id,
              title: s.title, content: s.content || '',
              position: 0, frameworkRefs: ['cascade'],
            })
          }
          fileBlocks = await window.cascade.blocks.list(file.id)
        }

        if (fileBlocks.length === 0) continue // no content, skip

        // Step 2: score every block
        for (let bi = 0; bi < fileBlocks.length; bi++) {
          const block = fileBlocks[bi]
          setScoreAllProgress(`File ${fi + 1}/${files.length} · Block ${bi + 1}/${fileBlocks.length}`)
          trackApiCall()
          const scored = await scoreBlock(block.title, block.content, file.content || '', block.framework_refs || ['cascade'])
          const layerList = await window.cascade.onion.list(block.id)
          for (let i = 0; i < scored.length; i++) {
            if (!layerList[i]) continue
            await window.cascade.onion.updateFramework({
              id: layerList[i].id,
              framework_score: scored[i].framework_score,
              framework_reasoning: scored[i].framework_reasoning,
              framework_refs: block.framework_refs || ['cascade'],
            })
          }
          const updated = await window.cascade.onion.list(block.id)
          const fwScore = computeBlockScore(updated, 'framework')
          await window.cascade.blocks.updateScore({ id: block.id, score: fwScore, scoredAt: Math.floor(Date.now() / 1000) })
          markFreshlyScored(block.id)
        }

        // Step 3: update file aggregate score
        const updatedBlocks = await window.cascade.blocks.list(file.id)
        const fScore = computeFileScore(updatedBlocks, 'framework')
        await window.cascade.files.updateScore({ id: file.id, score: fScore })
      }

      // Reload current view
      await loadFiles()
      if (activeFile) await loadBlocks(activeFile.id)
      if (activeBlock) await loadLayers(activeBlock.id)
      flashSave()
    } catch (e) { setAiError(e.message) }
    setScoringAll(false); setScoreAllProgress('')
  }

  // AI: re-score ALL blocks in file
  async function handleReScoreAll() {
    if (!activeFile || blocks.length === 0) return
    setRescoring(true); setAiError('')
    try {
      for (const block of blocks) {
        trackApiCall()
        const scored = await scoreBlock(block.title, block.content, activeFile.content || '', block.framework_refs || ['cascade'])
        const layerList = await window.cascade.onion.list(block.id)
        for (let i = 0; i < scored.length; i++) {
          if (!layerList[i]) continue
          await window.cascade.onion.updateFramework({
            id: layerList[i].id,
            framework_score: scored[i].framework_score,
            framework_reasoning: scored[i].framework_reasoning,
            framework_refs: block.framework_refs || ['cascade'],
          })
        }
        const updated = await window.cascade.onion.list(block.id)
        const fwScore = computeBlockScore(updated, 'framework')
        await window.cascade.blocks.updateScore({ id: block.id, score: fwScore, scoredAt: Math.floor(Date.now() / 1000) })
        markFreshlyScored(block.id)
      }
      const allBlocks = await window.cascade.blocks.list(activeFile.id)
      setBlocks(sortBlocks(allBlocks))
      if (activeBlock) await loadLayers(activeBlock.id)
      flashSave()
    } catch (e) { setAiError(e.message) }
    setRescoring(false)
  }

  // Group scoring
  function toggleSelect(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const selectedBlocks = blocks.filter(b => selected.has(b.id))
  const groupScore = selected.size > 1
    ? Math.round(selectedBlocks.reduce((a, b) => a + (b.score_aggregate || 0), 0) / selected.size)
    : null

  // Score mode toggle
  async function setMode(mode) {
    setScoreMode(mode)
    await window.cascade.pyramids.setDisplayMode({ id: pyramid.id, mode })
  }

  // Export markdown — save dialog
  async function exportMarkdown() {
    const lines = [`# ${pyramid.name}`, `> Score mode: ${scoreMode}`, '']
    for (const file of files) {
      lines.push(`## ${file.name}  (score: ${file.score_aggregate || '—'})`, '')
      const fileBlocks = await window.cascade.blocks.list(file.id)
      for (const block of fileBlocks) {
        const band = getScoreBand(block.score_aggregate || 0)
        lines.push(`### ${block.title}`)
        lines.push(`**Framework Score:** ${block.score_aggregate || '—'} · ${band.label}`)
        if (block.sovereign_score_aggregate) lines.push(`**Sovereign Score:** ${block.sovereign_score_aggregate}`)
        const ls = await window.cascade.onion.list(block.id)
        ls.forEach(l => {
          if (l.framework_score || l.score) {
            lines.push(`- **${l.layer_name}** ${l.framework_score || l.score} — ${l.framework_reasoning || l.content || ''}`)
          }
        })
        lines.push('')
      }
    }
    const result = await window.cascade.export.save({
      content: lines.join('\n'),
      defaultName: `${pyramid.name.replace(/\s+/g, '_')}.md`,
      ext: 'md',
    })
    if (result.ok) { setExportMsg('Saved!'); setTimeout(() => setExportMsg(''), 2000) }
  }

  // Export JSON — save dialog
  async function exportJSON() {
    const data = { pyramid, files: [] }
    for (const file of files) {
      const fileBlocks = await window.cascade.blocks.list(file.id)
      const blocksWithLayers = await Promise.all(fileBlocks.map(async b => ({
        ...b, layers: await window.cascade.onion.list(b.id)
      })))
      data.files.push({ ...file, blocks: blocksWithLayers })
    }
    const result = await window.cascade.export.save({
      content: JSON.stringify(data, null, 2),
      defaultName: `${pyramid.name.replace(/\s+/g, '_')}.json`,
      ext: 'json',
    })
    if (result.ok) { setExportMsg('Saved!'); setTimeout(() => setExportMsg(''), 2000) }
  }

  // Summary stats
  const scoredBlocks = blocks.filter(b => b.score_aggregate > 0)
  const avgScore = scoredBlocks.length ? Math.round(scoredBlocks.reduce((a, b) => a + b.score_aggregate, 0) / scoredBlocks.length) : 0
  const strongest = scoredBlocks.reduce((max, b) => b.score_aggregate > (max?.score_aggregate || 0) ? b : max, null)
  const weakest = scoredBlocks.length > 1 ? scoredBlocks.reduce((min, b) => b.score_aggregate < (min?.score_aggregate || 999) ? b : min, null) : null

  // Pi for active block
  const piScore = layers.length >= 4 ? computePi(layers, scoreMode) : null
  const layerViolations = layers.length >= 3 ? checkLayerDependencies(layers, scoreMode) : []

  // Truth velocity for active block (compare previous score to current)
  const activeBlockData = blocks.find(b => b.id === activeBlock?.id)

  const filteredBlocks = blocks.filter(b =>
    !search || b.title.toLowerCase().includes(search.toLowerCase())
  )
  const pyramidBand = getScoreBand(pyramid.score_aggregate || 0)
  const fileScore = activeFile?.score_aggregate || 0
  const fileBand = getScoreBand(fileScore)

  return (
    <div className="pyramid-view">
      {/* Top bar */}
      <div className="pv-topbar">
        <button className="btn" onClick={onBack}>← Pyramids</button>
        <div className="pv-title">
          <span className="pv-name">{pyramid.name}</span>
          {pyramid.score_aggregate > 0 && (
            <span className="pv-score" style={{ color: pyramidBand.textColor }}>
              {pyramid.score_aggregate} · {pyramidBand.label}
            </span>
          )}
        </div>
        <div className="mode-tabs" title="Switch score view: AI score / your score / average of both">
          {SCORE_MODES.map(m => (
            <button key={m} className={`mode-tab ${scoreMode === m ? 'active' : ''}`} onClick={() => setMode(m)}
              title={m === 'framework' ? 'AI score — locked, scored against Codex' : m === 'sovereign' ? 'Your score — free, 1–999' : 'Average of AI + your score'}>
              {m === 'framework' ? 'AI Score' : m === 'sovereign' ? 'My Score' : 'Combined'}
            </button>
          ))}
        </div>
        <div className="view-tabs">
          <button className={`view-tab ${view === 'blocks' ? 'active' : ''}`} onClick={() => setView('blocks')}>Blocks</button>
          <button className={`view-tab ${view === 'pyramid' ? 'active' : ''}`} onClick={() => setView('pyramid')}>△ Viz</button>
          {activeFile && <button className={`view-tab ${view === 'file' ? 'active' : ''}`} onClick={() => setView('file')}>File</button>}
          <button className={`view-tab ${showHelp ? 'active' : ''}`} onClick={() => setShowHelp(!showHelp)}>?</button>
        </div>
        <div className="topbar-right">
          {files.length > 0 && (
            <button className="btn score-all-btn" onClick={handleScoreAllFiles} disabled={scoringAll} title="Score every block in every file">
              {scoringAll ? <span className="score-all-progress">{scoreAllProgress || '...'}</span> : '⊚ Score all files'}
            </button>
          )}
          <button className="btn synth-btn" onClick={handleSynthesize} disabled={synthesizing} title="Synthesize all scored blocks into unified truth">
            {synthesizing ? '◎ Synthesizing…' : '◎ Synthesize'}
          </button>
          {cascadeEvents.length > 0 && (
            <button className={`btn cascade-log-btn ${cascadeEvents.some(e => e.severity === 'critical') ? 'critical' : ''}`}
              onClick={() => setShowCascadeLog(!showCascadeLog)} title="Cascade event log">
              ⚡ {cascadeEvents.length}
            </button>
          )}
          {tensions.length > 0 && (
            <button className={`btn tension-btn`} onClick={() => setShowTensions(!showTensions)} title="Cross-block tensions">
              ⊗ {tensions.length}
            </button>
          )}
          <span className="api-counter" title="API calls this session">◈ {apiCalls}</span>
          <span className={`save-indicator ${saveIndicator ? 'active' : ''}`}>● saved</span>
          <div className="export-btns">
            {exportMsg
              ? <span className="export-msg">{exportMsg}</span>
              : <>
                  <button className="btn" onClick={exportMarkdown}>↑ MD</button>
                  <button className="btn" onClick={exportJSON}>↑ JSON</button>
                </>
            }
          </div>
        </div>
      </div>

      {/* Upload warning */}
      {uploadWarning && <div className="pv-upload-warn">{uploadWarning}</div>}

      {/* Cascade event log */}
      {showCascadeLog && (
        <div className="cascade-log">
          <div className="cascade-log-header">
            <span>⚡ CASCADE EVENT LOG</span>
            <button className="btn" onClick={() => { setCascadeEvents([]); setShowCascadeLog(false) }}>Clear</button>
          </div>
          {cascadeEvents.map((ev, i) => (
            <div key={i} className={`cascade-event ${ev.severity}`}>
              <span className="ev-severity">{ev.severity.toUpperCase()}</span>
              <span>Block score dropped {ev.drop} pts ({ev.oldScore} → {ev.newScore})</span>
              <span className="ev-time">{fmtTime(Math.floor(ev.timestamp / 1000))}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tension detector */}
      {showTensions && tensions.length > 0 && (
        <div className="tension-panel">
          <div className="tension-header">⊗ CROSS-BLOCK TENSIONS</div>
          {tensions.map((t, i) => (
            <div key={i} className="tension-row">
              <span className="tension-block stronger">{t.stronger.title}</span>
              <span className="tension-delta">Δ{t.delta}</span>
              <span className="tension-block weaker">{t.weaker.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* Help panel */}
      {showHelp && (
        <div className="help-panel">
          <div className="help-title">CASCADE HELP</div>
          <div className="help-grid">
            <div className="help-section">
              <div className="help-sub">SCORING</div>
              <div className="help-row"><span className="help-key">Π = E·P/S</span><span>Evidence × Power ÷ Coherence</span></div>
              <div className="help-row"><span className="help-key">1–100</span><span>Calibrated range</span></div>
              <div className="help-row"><span className="help-key">101–999</span><span>Abstract/frontier truth</span></div>
              <div className="help-row"><span className="help-key">999</span><span>Beyond current verification</span></div>
              <div className="help-row"><span className="help-key">Framework</span><span>AI-scored, locked, Codex-referenced</span></div>
              <div className="help-row"><span className="help-key">Sovereign</span><span>Your truth pressure, free 1–999</span></div>
            </div>
            <div className="help-section">
              <div className="help-sub">LAYERS (9 ONION)</div>
              <div className="help-row"><span className="help-key">AXIOM</span><span>Irreducible core claim</span></div>
              <div className="help-row"><span className="help-key">FOUNDATION</span><span>Primary evidence</span></div>
              <div className="help-row"><span className="help-key">STRUCTURE</span><span>Logical architecture</span></div>
              <div className="help-row"><span className="help-key">COHERENCE</span><span>Internal consistency</span></div>
              <div className="help-row"><span className="help-key">RESONANCE</span><span>Connections to known truths</span></div>
              <div className="help-row"><span className="help-key">TENSION</span><span>Genuine friction (Nigredo)</span></div>
              <div className="help-row"><span className="help-key">CONTESTED</span><span>Active dispute zone</span></div>
              <div className="help-row"><span className="help-key">SPECULATIVE</span><span>Implies beyond proof</span></div>
              <div className="help-row"><span className="help-key">FRONTIER</span><span>Unknown edge</span></div>
            </div>
            <div className="help-section">
              <div className="help-sub">CONSTRAINTS</div>
              <div className="help-row"><span className="help-key">FOUNDATION</span><span>≤ AXIOM × 1.1</span></div>
              <div className="help-row"><span className="help-key">STRUCTURE</span><span>≤ FOUNDATION × 1.2</span></div>
              <div className="help-row"><span className="help-key">Block cap</span><span>≤ AXIOM × 1.2</span></div>
              <div className="help-sub" style={{marginTop:8}}>FILES</div>
              <div className="help-row"><span className="help-key">Max size</span><span>500KB per file</span></div>
              <div className="help-row"><span className="help-key">AI context</span><span>First 100KB used</span></div>
              <div className="help-row"><span className="help-key">Formats</span><span>.txt .md .json .csv</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Group score banner */}
      {selected.size > 1 && (
        <div className="group-bar">
          <span>{selected.size} block{selected.size > 1 ? 's' : ''} selected {selected.size > 10 ? <span className="group-cap">(cap: 10)</span> : ''}</span>
          {groupScore > 0 && (
            <span className="group-score" style={{ color: getScoreBand(groupScore).textColor }}>
              Group: <strong>{groupScore}</strong> · {getScoreBand(groupScore).label}
            </span>
          )}
          {selected.size >= 2 && selected.size <= 10 && (
            <button className="btn block-synth-btn" onClick={handleSynthesizeBlocks} disabled={blockSynthesizing}>
              {blockSynthesizing ? '◎ Finding truth…' : '◎ Synthesize selected'}
            </button>
          )}
          {selected.size > 10 && (
            <span className="group-cap-warn">Select 10 or fewer to synthesize</span>
          )}
          <button className="btn" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {aiError && <div className="pv-ai-error">{aiError}</div>}

      {/* Synthesis panel */}
      {showSynthesis && synthesis && (
        <div className="synth-panel">
          <div className="synth-panel-header">
            <span className="synth-panel-title">◎ PYRAMID SYNTHESIS</span>
            <button className="btn" onClick={async () => {
              if (!activeFile) return
              await window.cascade.blocks.create({
                fileId: activeFile.id, pyramidId: pyramid.id,
                title: synthesis.synthesis_title || 'Pyramid Synthesis',
                content: synthesis.core_claim + '\n\n' + synthesis.synthesis,
                position: 0, frameworkRefs: ['cascade'],
              })
              flashSave()
              await loadBlocks(activeFile.id)
              setShowSynthesis(false)
            }}>+ Save as block</button>
            <button className="btn" onClick={() => setShowSynthesis(false)}>✕</button>
          </div>
          <div className="synth-panel-body">
            <div className="synth-core">
              <div className="synth-label">CORE CLAIM</div>
              <div className="synth-core-text">{synthesis.core_claim}</div>
            </div>
            <div className="synth-full">
              <div className="synth-label">SYNTHESIS</div>
              <div className="synth-full-text">{synthesis.synthesis}</div>
            </div>
            <div className="synth-meta">
              {synthesis.pyramid_coherence > 0 && (
                <span className="synth-coherence">Coherence: <strong>{synthesis.pyramid_coherence}</strong></span>
              )}
              {synthesis.strongest_block && (
                <span className="synth-strongest">↑ {synthesis.strongest_block}</span>
              )}
              {synthesis.weakest_link && (
                <span className="synth-weakest">⚠ {synthesis.weakest_link}</span>
              )}
            </div>
            {synthesis.recommended_next && (
              <div className="synth-next">
                <span className="synth-label">NEXT</span>
                <span className="synth-next-text">{synthesis.recommended_next}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Block synthesis result panel */}
      {showBlockSynth && blockSynthResult && (
        <div className="cross-result-panel">
          <div className="cross-result-header">
            <span className="cross-result-title">◎ {blockSynthResult.emergent_title}</span>
            <span className="cross-coherence">{blockSynthResult.coherence}/100</span>
            <button className="btn" onClick={async () => {
              if (!activeFile) return
              await window.cascade.blocks.create({
                fileId: activeFile.id, pyramidId: pyramid.id,
                title: blockSynthResult.emergent_title || 'Block Synthesis',
                content: blockSynthResult.core_emergence + '\n\n' + blockSynthResult.synthesis,
                position: 0, frameworkRefs: ['cascade'],
              })
              flashSave()
              await loadBlocks(activeFile.id)
              setShowBlockSynth(false)
              setSelected(new Set())
            }}>+ Save as block</button>
            <button className="btn" onClick={() => setShowBlockSynth(false)}>✕</button>
          </div>
          <div className="cross-result-body">
            <div className="cross-emergence">
              <div className="cross-label">EMERGENT TRUTH · {selected.size} blocks</div>
              <div className="cross-emergence-text">{blockSynthResult.core_emergence}</div>
            </div>
            <div className="cross-synthesis-text">{blockSynthResult.synthesis}</div>
            <div className="cross-meta-row">
              {blockSynthResult.key_pattern && (
                <div className="cross-contrib">
                  <span className="cross-contrib-file">PATTERN</span>
                  <span className="cross-contrib-text">{blockSynthResult.key_pattern}</span>
                </div>
              )}
              {blockSynthResult.strongest_signal && (
                <div className="cross-contrib">
                  <span className="cross-contrib-file">STRONGEST SIGNAL</span>
                  <span className="cross-contrib-text" style={{color:'var(--layer-resonance)'}}>{blockSynthResult.strongest_signal}</span>
                </div>
              )}
              {blockSynthResult.outlier && blockSynthResult.outlier !== 'null' && (
                <div className="cross-contrib">
                  <span className="cross-contrib-file">OUTLIER</span>
                  <span className="cross-contrib-text" style={{color:'var(--layer-tension)'}}>{blockSynthResult.outlier}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cross-synthesis result panel */}
      {showCrossResult && crossResult && (
        <div className="cross-result-panel">
          <div className="cross-result-header">
            <span className="cross-result-title">◎ {crossResult.fileNames?.join(' × ')}</span>
            <span className="cross-coherence" title="Cross-coherence score">{crossResult.cross_coherence}/100</span>
            <button className="btn" onClick={async () => {
              if (!activeFile) return
              await window.cascade.blocks.create({
                fileId: activeFile.id, pyramidId: pyramid.id,
                title: crossResult.intersection_title || 'Cross-Synthesis',
                content: crossResult.core_emergence + '\n\n' + crossResult.synthesis,
                position: 0, frameworkRefs: ['cascade'],
              })
              flashSave()
              await loadBlocks(activeFile.id)
              setShowCrossResult(false)
            }}>+ Save as block</button>
            <button className="btn" onClick={() => setShowCrossResult(false)}>✕</button>
          </div>
          <div className="cross-result-body">
            <div className="cross-emergence">
              <div className="cross-label">EMERGENT TRUTH</div>
              <div className="cross-emergence-text">{crossResult.core_emergence}</div>
            </div>
            <div className="cross-synthesis-text">{crossResult.synthesis}</div>
            {crossResult.file_contributions?.length > 0 && (
              <div className="cross-meta-row">
                {crossResult.file_contributions.map((c, i) => (
                  <div key={i} className="cross-contrib">
                    <span className="cross-contrib-file">{c.file}</span>
                    <span className="cross-contrib-text">{c.contribution}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pyramid viz view */}
      {view === 'pyramid' && (
        <PyramidViz
          blocks={filteredBlocks}
          onSelectBlock={b => { setActiveBlock(b); setView('blocks') }}
          activeBlockId={activeBlock?.id}
          scoreMode={scoreMode}
        />
      )}

      {/* File content view */}
      {view === 'file' && activeFile && (
        <div className="file-content-view">
          <div className="fcv-header">
            {activeFile.name}
            <span className="file-size-badge">{fmtBytes(new TextEncoder().encode(activeFile.content || '').length)}</span>
          </div>
          <pre className="fcv-body">{activeFile.content || '(no content)'}</pre>
        </div>
      )}

      {/* Main blocks view */}
      {view === 'blocks' && (
        <div className="pv-body">
          {/* Files column */}
          <div
            className={`pv-files ${dragging ? 'dragging' : ''}`}
            ref={dropRef}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <div className="col-header"><span>FILES</span></div>

            {/* Quick-add file input — always visible */}
            <div className="quick-add-wrap">
              <input
                type="text"
                className="quick-add-input"
                placeholder="New file name… Enter to add"
                value={fileName}
                onChange={e => setFileName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') createFile()
                  if (e.key === 'Escape') setFileName('')
                }}
              />
              <button className="btn browse-btn" title="Browse for .txt .md .json .csv files" onClick={async () => {
                const { files: picked } = await window.cascade.files.openDialog()
                for (const f of picked) await createFileFromDrop(f.name, f.content, f.size)
              }}>Browse</button>
            </div>

            {/* File-level score bar */}
            {activeFile && fileScore > 0 && (
              <div className="file-score-bar-wrap">
                <div className="file-score-bar" style={{ width: `${Math.min(100, fileScore)}%`, background: fileBand.textColor }} />
                <span className="file-score-label" style={{ color: fileBand.textColor }}>{fileScore} FILE</span>
              </div>
            )}

            {/* Cross-synthesis controls */}
            {files.length >= 2 && (
              <div className="cross-synth-wrap">
                <div className="cross-synth-label">
                  ⊗ Cross-synthesize files
                  <span className="cross-synth-count">{crossFileIds.size > 0 ? ` · ${crossFileIds.size} selected` : ' · pick 2–10'}</span>
                </div>
                <div className="cross-file-list">
                  {files.map(f => (
                    <label key={f.id} className={`cross-file-item ${crossFileIds.has(f.id) ? 'checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={crossFileIds.has(f.id)}
                        onChange={() => { toggleCrossFile(f.id); setShowCrossResult(false) }}
                        className="cross-file-check"
                      />
                      <span className="cross-file-name">{f.name}</span>
                      {f.score_aggregate > 0 && <span className="cross-file-score">{f.score_aggregate}</span>}
                    </label>
                  ))}
                </div>
                {crossFileIds.size >= 2 && (
                  <button className="cross-synth-btn" onClick={handleCrossSynthesize} disabled={crossSynthesizing}>
                    {crossSynthesizing ? '◎ Finding intersection…' : `◎ Synthesize ${crossFileIds.size} files`}
                  </button>
                )}
              </div>
            )}

            {dragging ? (
              <div className="drop-overlay">
                <div>Drop file</div>
                <div className="drop-sub">.txt · .md · .json · max 500KB</div>
              </div>
            ) : (
              <div className="file-list">
                {files.length === 0 && (
                  <div className="col-empty">No files yet</div>
                )}
                {files.map(f => {
                  const band = getScoreBand(f.score_aggregate || 0)
                  return (
                    <div key={f.id} className={`file-item ${activeFile?.id === f.id ? 'active' : ''}`} onClick={() => setActiveFile(f)}>
                      <div className="file-name">{f.name}</div>
                      <div className="file-meta">
                        {f.score_aggregate > 0 ? <span style={{ color: band.textColor }}>{f.score_aggregate}</span> : <span className="dim">—</span>}
                        <button className="btn danger icon-btn" onClick={e => deleteFile(e, f.id)}>×</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Blocks column */}
          <div className="pv-blocks">
            <div className="col-header">
              <span>BLOCKS</span>
              {blocks.length > 0 && scoredBlocks.length < blocks.length && (
                <button className="btn" onClick={handleReScoreAll} disabled={rescoring}>
                  {rescoring ? '...' : '↻ Score all'}
                </button>
              )}
            </div>

            {/* STEP GUIDE — shown when file selected but no blocks yet */}
            {activeFile && blocks.length === 0 && (
              <div className="pipeline-guide">
                {activeFile.content ? (
                  <>
                    <div className="pg-step">
                      <span className="pg-num">1</span>
                      <div>
                        <div className="pg-label">Extract blocks from your file</div>
                        <div className="pg-sub">AI reads the content and suggests knowledge blocks</div>
                      </div>
                    </div>
                    <button className="pg-btn" onClick={handleSuggestBlocks} disabled={suggesting}>
                      {suggesting ? '⊚ Reading file...' : '⊚ AI — Suggest blocks'}
                    </button>
                    <div className="pg-divider">or add manually below</div>
                  </>
                ) : (
                  <div className="pg-step">
                    <span className="pg-num">1</span>
                    <div>
                      <div className="pg-label">Add blocks manually</div>
                      <div className="pg-sub">Type a title below and press Enter. For AI extraction, drag a .txt or .md file into the FILES column.</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SCORE CTA — blocks exist but none scored */}
            {blocks.length > 0 && scoredBlocks.length === 0 && (
              <div className="pipeline-guide compact">
                <div className="pg-step">
                  <span className="pg-num">2</span>
                  <div>
                    <div className="pg-label">Score your blocks</div>
                    <div className="pg-sub">Select a block → use ⊚ AI Score in the panel, or score all at once</div>
                  </div>
                </div>
                <button className="pg-btn" onClick={handleReScoreAll} disabled={rescoring}>
                  {rescoring ? '⊚ Scoring...' : '↻ Score all blocks now'}
                </button>
              </div>
            )}

            {/* Scoring progress strip */}
            {blocks.length > 0 && (() => {
              const allScored = blocks.every(b => b.score_aggregate > 0)
              return (
                <div className={`scoring-strip ${allScored ? 'complete' : ''}`}>
                  {blocks.map(b => (
                    <span
                      key={b.id}
                      className={`score-pyr ${b.score_aggregate > 0 ? 'scored' : 'unscored'}`}
                      title={`${b.title}${b.score_aggregate > 0 ? ' · ' + b.score_aggregate : ' · unscored'}`}
                      onClick={() => setActiveBlock(b)}
                    >△</span>
                  ))}
                  {allScored && <span className="strip-complete">COMPLETE</span>}
                </div>
              )
            })()}

            {/* Quick-add block input */}
            {activeFile && (
              <div className="quick-add-wrap">
                <input
                  type="text"
                  className="quick-add-input"
                  placeholder="New block title… Enter to add"
                  value={blockTitle}
                  onChange={e => setBlockTitle(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') createBlock(blockTitle, '', blockFrameworks)
                    if (e.key === 'Escape') setBlockTitle('')
                  }}
                />
              </div>
            )}

            {/* Summary stats */}
            {scoredBlocks.length > 0 && (
              <div className="block-stats">
                <span>{blocks.length} · {scoredBlocks.length} scored</span>
                {avgScore > 0 && <span style={{ color: getScoreBand(avgScore).textColor }}>avg {avgScore}</span>}
                {strongest && <span className="stat-strongest">↑ {strongest.title.slice(0, 18)}</span>}
              </div>
            )}

            {/* Search */}
            {blocks.length > 2 && (
              <div className="block-search">
                <input type="text" placeholder="Search…" value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Escape' && setSearch('')} />
              </div>
            )}

            <div className="block-list">
              {filteredBlocks.map((b, idx) => {
                const band = getScoreBand(b.score_aggregate || 0)
                const isSelected = selected.has(b.id)
                const isFresh = freshlyScored.has(b.id)
                const pct = Math.min(100, b.score_aggregate || 0)
                const isInTension = tensions.some(t => t.blockA.id === b.id || t.blockB.id === b.id)
                const isEditingNotes = editingNotes === b.id
                return (
                  <div key={b.id}
                    className={`block-item ${activeBlock?.id === b.id ? 'active' : ''} ${isSelected ? 'selected' : ''} ${isFresh ? 'fresh-scored' : ''}`}
                    style={isFresh ? { '--glow-color': band.textColor } : {}}
                    onClick={() => setActiveBlock(b)}>
                    <div className="block-row-top">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(b.id)} onClick={e => e.stopPropagation()} className="block-check" />
                      <div className="block-title">
                        {b.title}
                        {isInTension && <span className="tension-indicator" title="In tension with another block">⊗</span>}
                      </div>
                      <div className="block-reorder">
                        <button className="btn icon-btn" onClick={e => { e.stopPropagation(); moveBlock(b.id, -1) }}>↑</button>
                        <button className="btn icon-btn" onClick={e => { e.stopPropagation(); moveBlock(b.id, 1) }}>↓</button>
                        <button className="btn icon-btn" onClick={e => duplicateBlock(e, b.id)} title="Duplicate block">⊕</button>
                        <button className="btn danger icon-btn" onClick={e => deleteBlock(e, b.id)}>×</button>
                      </div>
                    </div>

                    {b.content && (
                      <div
                        className={`block-preview ${expandedBlocks.has(b.id) ? 'expanded' : ''}`}
                        onClick={e => toggleExpand(e, b.id)}
                        title={expandedBlocks.has(b.id) ? 'Click to collapse' : 'Click to expand'}
                      >
                        {expandedBlocks.has(b.id)
                          ? b.content
                          : <>{b.content.slice(0, 80)}{b.content.length > 80 ? <span className="preview-more"> ▾</span> : ''}</>
                        }
                        {expandedBlocks.has(b.id) && <span className="preview-more"> ▴</span>}
                      </div>
                    )}

                    {/* Score bar */}
                    {b.score_aggregate > 0 && (
                      <div className="block-score-bar">
                        <div className="block-score-fill" style={{ width: `${pct}%`, background: band.textColor }} />
                      </div>
                    )}

                    <div className="block-meta">
                      {b.score_aggregate > 0
                        ? <span className="block-score" style={{ color: band.textColor }}>{b.score_aggregate} · {band.label}</span>
                        : <span className="dim">unscored</span>}
                      {b.scored_at && <span className="block-ts">{fmtTime(b.scored_at)}</span>}
                      {b.framework_refs?.length > 0 && (
                        <span className="block-refs">{b.framework_refs.map(r => FRAMEWORK_LIST.find(f => f.id === r)?.glyph || r).join(' ')}</span>
                      )}
                      <button className="btn icon-btn notes-btn" onClick={e => { e.stopPropagation(); setEditingNotes(b.id); setNotesValue(b.notes || '') }}
                        title={b.notes ? 'Edit notes' : 'Add notes'}>
                        {b.notes ? '✎' : '✎'}
                      </button>
                    </div>

                    {/* Notes inline editor */}
                    {isEditingNotes && (
                      <div className="block-notes-editor" onClick={e => e.stopPropagation()}>
                        <textarea
                          value={notesValue}
                          onChange={e => setNotesValue(e.target.value)}
                          placeholder="Block notes..."
                          rows={3}
                          autoFocus
                          className="notes-textarea"
                          onKeyDown={e => { if (e.key === 'Escape') setEditingNotes(null) }}
                        />
                        <div className="notes-actions">
                          <button className="btn" onClick={() => setEditingNotes(null)}>Cancel</button>
                          <button className="btn primary" onClick={() => saveNotes(b.id)}>Save</button>
                        </div>
                      </div>
                    )}

                    {/* Show existing notes preview */}
                    {b.notes && !isEditingNotes && (
                      <div className="block-notes-preview">{b.notes.slice(0, 80)}{b.notes.length > 80 ? '...' : ''}</div>
                    )}
                  </div>
                )
              })}
              {filteredBlocks.length === 0 && !addingBlock && activeFile && (
                <div className="col-empty">No blocks{search ? ' matching search' : ''}<br/>{!search && 'Press ⊚ AI or + to add'}</div>
              )}
              {!activeFile && <div className="col-empty">Select a file</div>}
            </div>
          </div>

          {/* Right panel: content pane + scoring */}
          <div className="pv-onion">
            {activeBlock ? (
              <div className="right-panel">
                {/* Block content reading pane */}
                <div className="block-reading-pane">
                  <div className="brp-header">
                    <span className="brp-title">{activeBlock.title}</span>
                    {activeBlock.score_aggregate > 0 && (
                      <span className="brp-score" style={{ color: getScoreBand(activeBlock.score_aggregate).textColor }}>
                        {activeBlock.score_aggregate} · {getScoreBand(activeBlock.score_aggregate).label}
                      </span>
                    )}
                    {piScore !== null && piScore > 0 && (
                      <span className="brp-pi" title="Π = E·P/S">Π {piScore}</span>
                    )}
                  </div>
                  {activeBlock.content
                    ? <div className="brp-content">{activeBlock.content}</div>
                    : <div className="brp-empty">No content — add it via the block title or drag a file.</div>
                  }
                  {activeBlock.notes && (
                    <div className="brp-notes">{activeBlock.notes}</div>
                  )}
                </div>

                {/* Scoring section */}
                <div className="scoring-section">
                  <div className="scoring-section-header">
                    <OnionRing layers={layers} size={80} />
                    {layerViolations.length > 0 && (
                      <div className="dep-warnings-inline">
                        {layerViolations.map((v, i) => (
                          <div key={i} className="dep-warn">⚠ {v.violation} (cap: {v.cap})</div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="onion-panel">
                    <OnionEditor block={activeBlock} fileContent={activeFile?.content || ''} onSaved={onLayerSaved} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="onion-empty">
                <div className="onion-empty-icon">◎</div>
                <div className="onion-empty-text">Select a block</div>
                <div className="onion-empty-sub">9 layers · AXIOM → FRONTIER</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
