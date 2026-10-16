import Dexie from 'dexie';

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
  links: '++id, sourceNoteId, targetTitle, targetNoteId, [sourceNoteId+targetTitle]'
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

  return result;
}

export async function deleteNote(id) {
  await db.transaction('rw', db.notes, db.links, async () => {
    await db.notes.delete(id);
    await db.links.where('sourceNoteId').equals(id).delete();
  });
}

export default db;
