import Dexie from 'dexie';
import { pipeline, env, cos_sim } from '@xenova/transformers';

/**
 * Computes cosine similarity between two numeric or TypedArray vectors
 * @param {Array<number>|Float32Array} a
 * @param {Array<number>|Float32Array} b
 * @returns {number}
 */
export function cosine_similarity(a, b) {
  if (typeof cos_sim === 'function') {
    return cos_sim(a, b);
  }
  let dotProduct = 0;
  let mA = 0;
  let mB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    mA += a[i] * a[i];
    mB += b[i] * b[i];
  }
  const magnitude = Math.sqrt(mA) * Math.sqrt(mB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// Configure transformers.js for client-side browser execution
// Disable local filesystem search and enable browser Cache API for model caching
env.allowLocalModels = false;
env.useBrowserCache = true;

export const db = new Dexie('NoteGraphDB');

// Define database schema versions
db.version(1).stores({
  notes: '++id, title, createdAt, updatedAt'
});

db.version(2).stores({
  notes: '++id, title, createdAt, updatedAt',
  links: '++id, sourceNoteId, targetTitle, targetNoteId, [sourceNoteId+targetTitle]'
});

db.version(3).stores({
  notes: '++id, title, createdAt, updatedAt, fileName',
  links: '++id, sourceNoteId, targetTitle, targetNoteId, [sourceNoteId+targetTitle]',
  semanticLinks: '++id, sourceNoteId, targetNoteId, score, [sourceNoteId+targetNoteId]'
});

// Regular Expression to scan text and detect double-bracket links like [[Project Ideas]]
export const WIKI_LINK_REGEX = /\[\[([^[\]]+)\]\]/g;

/**
 * Scan raw note content and extract unique target titles
 * @param {string} text - Raw note markdown content
 * @returns {string[]} Array of unique trimmed target titles
 */
export function extractWikiLinks(text) {
  if (!text) return [];
  const matches = [...text.matchAll(WIKI_LINK_REGEX)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  return [...new Set(matches)];
}

// Seed data for initial database creation
const initialNotes = [
  {
    title: 'Project Ideas',
    fileName: 'Project Ideas.md',
    content: '# Project Ideas\n\nBuilding a [[PWA Knowledge Base]] with real-time IndexedDB persistence and graph visualization.\n\n- Offline-first storage with Dexie.js\n- Dynamic bidirectional backlinks\n- Force-directed graph simulation',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    title: 'PWA Knowledge Base',
    fileName: 'PWA Knowledge Base.md',
    content: '# PWA Knowledge Base\n\nUses [[IndexedDB]] via Dexie.js and [[D3.js]] for interactive knowledge graph exploration.\n\n### Key Features\n1. Lightning fast local storage\n2. Real-time live query hooks\n3. Automatic relationship tracking',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    title: 'IndexedDB',
    fileName: 'IndexedDB.md',
    content: '# IndexedDB\n\nClient-side storage system managed seamlessly with **Dexie.js** for lightning-fast offline queries.\n\n> "IndexedDB enables powerful web apps to work offline with full persistence."',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    title: 'D3.js',
    fileName: 'D3.js.md',
    content: '# D3.js\n\nInteractive force-directed graph layout engine used to map node relationships dynamically.\n\nReferenced by [[PWA Knowledge Base]].',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

/**
 * Synchronize all outgoing wiki links for a source note in the database `links` table
 * @param {number} sourceNoteId - The id of the note containing the links
 * @param {string} content - Raw content to parse for links
 */
export async function syncNoteLinks(sourceNoteId, content) {
  if (!sourceNoteId) return;
  const targetTitles = extractWikiLinks(content);

  await db.transaction('rw', db.links, db.notes, async () => {
    // Remove existing links for this source note
    await db.links.where('sourceNoteId').equals(sourceNoteId).delete();

    if (targetTitles.length === 0) return;

    // Resolve targetNoteId if target note already exists in the database
    const linkEntries = await Promise.all(
      targetTitles.map(async (targetTitle) => {
        const targetNote = await db.notes
          .filter(
            (n) => n.title && n.title.trim().toLowerCase() === targetTitle.toLowerCase()
          )
          .first();

        return {
          sourceNoteId,
          targetTitle,
          targetNoteId: targetNote ? targetNote.id : null,
          createdAt: new Date().toISOString()
        };
      })
    );

    // Prevent duplicates in compound index [sourceNoteId+targetTitle]
    const uniqueLinks = [];
    const seen = new Set();
    for (const link of linkEntries) {
      const key = `${link.sourceNoteId}:${link.targetTitle.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueLinks.push(link);
      }
    }

    if (uniqueLinks.length > 0) {
      await db.links.bulkAdd(uniqueLinks);
    }
  });
}

/**
 * Re-scan and synchronize wiki links for every note currently in the database
 */
export async function syncAllNoteLinks() {
  const allNotes = await db.notes.toArray();
  for (const note of allNotes) {
    if (note.content) {
      await syncNoteLinks(note.id, note.content);
    }
  }
}

// ------------------- NLP SEMANTIC EMBEDDINGS & SIMILARITY -------------------

// ------------------- NLP SEMANTIC EMBEDDINGS & SIMILARITY -------------------

// 1. Initialize the feature extraction pipeline (loads once)
let extractor = null;
let extractorPromise = null;

// In-memory cache for computed note embeddings: noteId -> { hash: number, data: Array<number> }
const embeddingsCache = new Map();

// Reactive NLP status tracking
let nlpStatus = { state: 'idle', message: 'NLP Ready', lastUpdated: Date.now() };
const nlpListeners = new Set();

export function getNlpStatus() {
  return nlpStatus;
}

export function subscribeNlpStatus(listener) {
  nlpListeners.add(listener);
  listener(nlpStatus);
  return () => nlpListeners.delete(listener);
}

function setNlpStatus(state, message = '') {
  nlpStatus = { state, message, lastUpdated: Date.now() };
  nlpListeners.forEach((fn) => {
    try {
      fn(nlpStatus);
    } catch (e) {
      console.warn('NLP status listener error:', e);
    }
  });
}

/**
 * Lightweight string hash to detect whether note content has actually changed
 */
function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * Offline/fallback cosine similarity using term frequencies if model download is unavailable
 */
function fallbackCosineSimilarity(textA, textB) {
  const tokenize = (str) =>
    (str || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

  const wordsA = tokenize(textA);
  const wordsB = tokenize(textB);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const freqA = {};
  const freqB = {};
  wordsA.forEach((w) => (freqA[w] = (freqA[w] || 0) + 1));
  wordsB.forEach((w) => (freqB[w] = (freqB[w] || 0) + 1));

  const allWords = Array.from(new Set([...wordsA, ...wordsB]));
  let dotProduct = 0;
  let mA = 0;
  let mB = 0;

  for (const w of allWords) {
    const a = freqA[w] || 0;
    const b = freqB[w] || 0;
    dotProduct += a * b;
    mA += a * a;
    mB += b * b;
  }

  const mag = Math.sqrt(mA) * Math.sqrt(mB);
  return mag === 0 ? 0 : dotProduct / mag;
}

export async function getExtractor() {
  if (!extractor) {
    if (!extractorPromise) {
      setNlpStatus('loading', 'Loading all-MiniLM-L6-v2 neural model...');
      extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true
      })
        .then((pipe) => {
          extractor = pipe;
          setNlpStatus('idle', 'NLP Model Ready');
          return pipe;
        })
        .catch((err) => {
          extractorPromise = null;
          setNlpStatus('fallback', 'Using fast keyword similarity fallback');
          console.warn('[NLP] Neural model unavailable, using keyword fallback:', err);
          throw err;
        });
    }
    return extractorPromise;
  }
  return extractor;
}

/**
 * Extracts unified text representation for NLP embedding from a note or todo
 * @param {Object|string} note - Note object or string
 * @returns {string} Plain text to embed
 */
function getNoteText(note) {
  if (typeof note === 'string') return note;
  if (!note) return '';
  if (note.text) return note.text;
  const parts = [];
  if (note.title) parts.push(note.title);
  if (note.content) parts.push(note.content);
  return parts.join('\n').trim();
}

/**
 * 2. Find and link related notes using NLP semantic vector similarity
 * @param {Array<Object>} notes - Array of note/todo objects
 * @param {number} threshold - Cosine similarity threshold (default 0.40)
 * @returns {Promise<Array<Object>>} Notes appended with their semantic links
 */
export async function linkSimilarNotes(notes, threshold = 0.40) {
  if (!notes || notes.length === 0) return [];

  let pipe = null;
  try {
    pipe = await getExtractor();
  } catch (err) {
    console.warn('[NLP] Falling back to text similarity:', err.message);
  }

  // Generate or retrieve cached embeddings for all notes
  const embeddings = [];
  for (const note of notes) {
    const text = getNoteText(note) || 'Untitled Note';
    const textHash = hashText(text);
    const cached = embeddingsCache.get(note.id);

    if (cached && cached.hash === textHash && cached.data) {
      embeddings.push(cached.data);
    } else if (pipe) {
      try {
        const output = await pipe(text, { pooling: 'mean', normalize: true });
        const vector = Array.from(output.data);
        embeddingsCache.set(note.id, { hash: textHash, data: vector });
        embeddings.push(vector);
      } catch (e) {
        console.warn('[NLP] Embedding extraction failed for note:', note.id, e);
        embeddings.push(null);
      }
    } else {
      embeddings.push(null);
    }
  }

  // Compare every note with every other note
  const linkedNotes = notes.map((note, i) => {
    const relatedLinks = [];

    for (let j = 0; j < notes.length; j++) {
      if (i === j) continue; // Skip comparing a note to itself

      let score = 0;
      if (embeddings[i] && embeddings[j]) {
        score = cosine_similarity(embeddings[i], embeddings[j]);
      } else {
        score = fallbackCosineSimilarity(getNoteText(note), getNoteText(notes[j]));
      }

      // Link them if they pass threshold
      if (score >= threshold) {
        relatedLinks.push({
          id: notes[j].id,
          title: notes[j].title || '',
          text: notes[j].text || notes[j].content || '',
          score: Number(score.toFixed(2))
        });
      }
    }

    // Sort related links by highest similarity first
    relatedLinks.sort((a, b) => b.score - a.score);

    return {
      ...note,
      links: relatedLinks
    };
  });

  return linkedNotes;
}

/**
 * Computes semantic similarity across all notes in IndexedDB and stores them in:
 * 1. The note records in `db.notes` (updating each note with a sorted `links` array)
 * 2. The `semanticLinks` table in IndexedDB with exact pairwise similarity scores
 * @param {number} threshold - Min score filter for db.notes.links (default 0.30)
 * @returns {Promise<Array>} Array of updated notes with links
 */
export async function syncSemanticLinks(threshold = 0.30) {
  try {
    setNlpStatus('computing', 'Analyzing semantic connections...');
    const allNotes = await db.notes.toArray();
    if (!allNotes || allNotes.length < 2) {
      if (allNotes && allNotes.length === 1) {
        await db.notes.update(allNotes[0].id, { links: [] });
      }
      await db.semanticLinks.clear();
      setNlpStatus('idle', 'NLP Ready');
      return allNotes || [];
    }

    let pipe = null;
    try {
      pipe = await getExtractor();
    } catch (err) {
      console.warn('[NLP] Neural pipe failed, using fallback:', err.message);
    }

    // Compute or load cached embeddings
    const embeddings = [];
    for (const note of allNotes) {
      const text = getNoteText(note) || 'Untitled Note';
      const textHash = hashText(text);
      const cached = embeddingsCache.get(note.id);

      if (cached && cached.hash === textHash && cached.data) {
        embeddings.push(cached.data);
      } else if (pipe) {
        try {
          const output = await pipe(text, { pooling: 'mean', normalize: true });
          const vector = Array.from(output.data);
          embeddingsCache.set(note.id, { hash: textHash, data: vector });
          embeddings.push(vector);
        } catch (e) {
          console.warn('[NLP] Error creating embedding:', e);
          embeddings.push(null);
        }
      } else {
        embeddings.push(null);
      }
    }

    // Compute all pairwise scores between every unique pair (i < j)
    const pairwiseRecords = [];
    const noteLinksMap = new Map();
    allNotes.forEach((n) => noteLinksMap.set(n.id, []));

    for (let i = 0; i < allNotes.length; i++) {
      for (let j = i + 1; j < allNotes.length; j++) {
        let score = 0;
        if (embeddings[i] && embeddings[j]) {
          score = cosine_similarity(embeddings[i], embeddings[j]);
        } else {
          score = fallbackCosineSimilarity(getNoteText(allNotes[i]), getNoteText(allNotes[j]));
        }

        const normalizedScore = Number(Math.max(0, Math.min(1, score)).toFixed(2));

        pairwiseRecords.push({
          sourceNoteId: allNotes[i].id,
          targetNoteId: allNotes[j].id,
          sourceTitle: allNotes[i].title || 'Untitled Note',
          targetTitle: allNotes[j].title || 'Untitled Note',
          score: normalizedScore,
          createdAt: new Date().toISOString()
        });

        // Add to both notes' local links for fast note-centric lookup
        noteLinksMap.get(allNotes[i].id).push({
          id: allNotes[j].id,
          title: allNotes[j].title || '',
          score: normalizedScore
        });
        noteLinksMap.get(allNotes[j].id).push({
          id: allNotes[i].id,
          title: allNotes[i].title || '',
          score: normalizedScore
        });
      }
    }

    // Persist into IndexedDB
    await db.transaction('rw', db.notes, db.semanticLinks, async () => {
      // 1. Update notes table with sorted links
      for (const note of allNotes) {
        const sortedLinks = (noteLinksMap.get(note.id) || [])
          .filter((l) => l.score >= threshold)
          .sort((a, b) => b.score - a.score);
        await db.notes.update(note.id, { links: sortedLinks });
      }

      // 2. Replace semanticLinks table with all computed pairs
      await db.semanticLinks.clear();
      if (pairwiseRecords.length > 0) {
        await db.semanticLinks.bulkAdd(pairwiseRecords);
      }
    });

    setNlpStatus('idle', `NLP Connected (${pairwiseRecords.length} pairs calculated)`);
    console.log(`[NLP] Successfully computed ${pairwiseRecords.length} pairwise semantic links.`);
    return allNotes;
  } catch (err) {
    console.error('[NLP] Error syncing semantic links:', err);
    setNlpStatus('error', err.message || 'NLP sync error');
    return [];
  }
}

// Debounce timer for background semantic syncing
let syncTimeout = null;

/**
 * Schedule background semantic link calculation after an editing pause
 * @param {number} delayMs - Debounce delay in ms (default 2000ms)
 */
export function scheduleSemanticSync(delayMs = 2000) {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }
  syncTimeout = setTimeout(() => {
    syncSemanticLinks().catch((err) => {
      console.warn('[NLP] Scheduled sync failed:', err);
    });
  }, delayMs);
}

// Initial populate listener
db.on('populate', async () => {
  await db.notes.bulkAdd(initialNotes);
});

// Ensure default notes and links exist if the database is opened empty or upgraded
export async function ensureInitialNotes() {
  const count = await db.notes.count();
  if (count === 0) {
    await db.notes.bulkAdd(initialNotes);
  }

  // Ensure links table is populated for all existing notes
  const linksCount = await db.links.count();
  if (linksCount === 0) {
    await syncAllNoteLinks();
  }

  // Ensure semantic links are computed for existing notes
  const semanticCount = await db.semanticLinks.count();
  if (semanticCount === 0) {
    syncSemanticLinks().catch(console.warn);
  }
}

/**
 * Replace all notes in the database with notes loaded from a local directory
 * @param {Array<{ title: string, content: string, fileName: string }>} folderNotes
 * @returns {Promise<Array>} Newly stored notes
 */
export async function replaceNotesFromFolder(folderNotes) {
  return await db.transaction('rw', db.notes, db.links, async () => {
    await db.notes.clear();
    await db.links.clear();

    if (!folderNotes || folderNotes.length === 0) {
      return [];
    }

    const records = folderNotes.map((n) => ({
      title: n.title,
      fileName: n.fileName,
      content: n.content,
      createdAt: n.createdAt || new Date().toISOString(),
      updatedAt: n.updatedAt || new Date().toISOString()
    }));

    await db.notes.bulkAdd(records);
    const storedNotes = await db.notes.toArray();

    // Re-link notes
    for (const note of storedNotes) {
      if (note.content) {
        await syncNoteLinks(note.id, note.content);
      }
    }
    scheduleSemanticSync(1500);

    return storedNotes;
  });
}

// Database helper functions
export async function createNote(title = 'Untitled Note', content = '', extra = {}) {
  const now = new Date().toISOString();
  const id = await db.notes.add({
    title,
    content,
    fileName: extra.fileName || `${title}.md`,
    createdAt: now,
    updatedAt: now,
    ...extra
  });
  if (content) {
    await syncNoteLinks(id, content);
  }
  scheduleSemanticSync(2000);
  return id;
}

export async function updateNote(id, changes) {
  const result = await db.notes.update(id, {
    ...changes,
    updatedAt: new Date().toISOString()
  });

  // Automatically scan and sync links table when content changes
  if (changes.content !== undefined) {
    await syncNoteLinks(id, changes.content);
  }

  // Update targetTitle for any links pointing to this note if title changes
  if (changes.title !== undefined) {
    const newTitle = changes.title.trim();
    await db.links
      .filter((link) => link.targetNoteId === id)
      .modify({ targetTitle: newTitle });
  }

  // Schedule background NLP similarity update if content or title changed
  if (changes.content !== undefined || changes.title !== undefined) {
    scheduleSemanticSync(3000);
  }

  return result;
}

export async function deleteNote(id) {
  await db.transaction('rw', db.notes, db.links, db.semanticLinks, async () => {
    await db.notes.delete(id);
    await db.links.where('sourceNoteId').equals(id).delete();
    await db.semanticLinks.where('sourceNoteId').equals(id).delete();
    await db.semanticLinks.where('targetNoteId').equals(id).delete();
  });
  scheduleSemanticSync(1500);
}

/**
 * Completely resets and clears IndexedDB NoteGraphDB, then reloads the page
 */
export async function resetDatabase() {
  console.log('[DB] Deleting NoteGraphDB...');
  await db.delete();
  console.log('[DB] Database deleted. Reloading...');
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

// Expose debug utilities to browser DevTools console
if (typeof window !== 'undefined') {
  window.db = db;
  window.syncSemanticLinks = syncSemanticLinks;
  window.resetDatabase = resetDatabase;
  console.log('[NLP DB] Helpers attached to window: window.db, window.syncSemanticLinks(), window.resetDatabase()');
}

export default db;

