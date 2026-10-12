import { useState, useEffect } from 'react';
import { Plus, BookOpen, Edit3, Network, ArrowLeftRight, Search, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { marked } from 'marked';
import { db, createNote, updateNote, deleteNote, ensureInitialNotes, WIKI_LINK_REGEX } from './db';
import StartPage from './components/StartPage';

// Configure marked options for clean GFM translation with line breaks
marked.setOptions({
  gfm: true,
  breaks: true,
});

export default function App() {
  const [currentPage, setCurrentPage] = useState('start');
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [activeTab, setActiveTab] = useState('edit'); // 'edit' | 'preview'
  const [searchQuery, setSearchQuery] = useState('');

  // Local state for responsive editing without async input jitter
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  // Seed sample notes and populate links table if empty
  useEffect(() => {
    ensureInitialNotes();
  }, []);

  // Real-time Dexie.js live query connecting to local notes table
  const notes = useLiveQuery(
    () => {
      if (!searchQuery.trim()) {
        return db.notes.toArray();
      }
      const q = searchQuery.toLowerCase();
      return db.notes
        .filter(
          (note) =>
            (note.title && note.title.toLowerCase().includes(q)) ||
            (note.content && note.content.toLowerCase().includes(q))
        )
        .toArray();
    },
    [searchQuery],
    []
  );

  // Real-time count of active connections in db.links
  const totalLinksCount = useLiveQuery(() => db.links.count(), [], 0);

  // Initialize activeNoteId on initial load
  useEffect(() => {
    if (notes && notes.length > 0) {
      if (activeNoteId === null) {
        setActiveNoteId(notes[0].id);
      }
    } else if (notes && notes.length === 0) {
      setActiveNoteId(null);
    }
  }, [notes, activeNoteId]);

  const activeNote = notes?.find((n) => n.id === activeNoteId);

  // Synchronize local input buffers when switching to a different note
  useEffect(() => {
    const note = notes?.find((n) => n.id === activeNoteId);
    if (note) {
      setTitle(note.title ?? '');
      setContent(note.content ?? '');
    } else {
      setTitle('');
      setContent('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId]);

  const currentTitle = title.trim() || activeNote?.title || '';

  // Real-time Dexie.js live query connecting to local 'links' table for backlinks
  const backlinks = useLiveQuery(
    async () => {
      if (!activeNoteId || !currentTitle) return [];

      const normalizedTitle = currentTitle.trim().toLowerCase();

      // Find all incoming links in db.links pointing to this note (by ID or targetTitle)
      const incomingLinks = await db.links
        .filter(
          (link) =>
            link.sourceNoteId !== activeNoteId &&
            ((link.targetNoteId && link.targetNoteId === activeNoteId) ||
              (link.targetTitle && link.targetTitle.trim().toLowerCase() === normalizedTitle))
        )
        .toArray();

      if (incomingLinks.length === 0) return [];

      // Fetch the source notes for these links
      const sourceIds = [...new Set(incomingLinks.map((l) => l.sourceNoteId))];
      const sourceNotes = await db.notes.where('id').anyOf(sourceIds).toArray();

      return sourceNotes.map((sourceNote) => {
        const link = incomingLinks.find((l) => l.sourceNoteId === sourceNote.id);
        return {
          id: sourceNote.id,
          title: sourceNote.title,
          content: sourceNote.content,
          targetTitle: link?.targetTitle || currentTitle,
        };
      });
    },
    [activeNoteId, currentTitle],
    []
  );

  const handleCreateNote = async () => {
    const id = await createNote('Untitled Note', '');
    setActiveNoteId(id);
    setTitle('Untitled Note');
    setContent('');
    setActiveTab('edit');
  };

  const handleDeleteNote = async (idToDelete) => {
    if (!idToDelete) return;
    await deleteNote(idToDelete);
    if (activeNoteId === idToDelete) {
      const remaining = notes.filter((n) => n.id !== idToDelete);
      setActiveNoteId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    if (activeNoteId) {
      updateNote(activeNoteId, { title: newTitle });
    }
  };

  const handleContentChange = (e) => {
    const newContent = e.target.value;
    setContent(newContent);
    if (activeNoteId) {
      updateNote(activeNoteId, { content: newContent });
    }
  };

  // Convert raw markdown into clean formatted HTML with interactive wiki links
  const renderMarkdown = (rawContent) => {
    if (!rawContent) return '';
    // Transform [[Note Title]] into clean interactive wiki-link elements
    const linkedContent = rawContent.replace(
      WIKI_LINK_REGEX,
      '<span class="wiki-link" data-wiki-target="$1">$1</span>'
    );
    return marked.parse(linkedContent);
  };

  // Allow clicking on wiki-links inside the preview pane to jump directly to the target note
  const handlePreviewClick = (e) => {
    const targetEl = e.target.closest('[data-wiki-target]');
    if (targetEl) {
      const targetTitle = targetEl.getAttribute('data-wiki-target')?.trim().toLowerCase();
      const targetNote = notes?.find(
        (n) => n.title && n.title.trim().toLowerCase() === targetTitle
      );
      if (targetNote) {
        setActiveNoteId(targetNote.id);
      }
    }
  };

  if (currentPage === 'start') {
    return <StartPage onContinue={() => setCurrentPage('workspace')} />;
  }

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* ------------------- LEFT COLUMN: NOTE LIST ------------------- */}
      <aside className="w-64 border-r border-slate-800 flex flex-col bg-slate-900/50">
        {/* App Title Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <button
            onClick={() => setCurrentPage('start')}
            className="flex items-center gap-2 font-bold text-lg text-indigo-400 hover:text-indigo-300 transition cursor-pointer text-left"
            title="Return to Start Page"
          >
            <Network className="w-5 h-5" />
            <span>NoteGraph</span>
          </button>
          <button
            onClick={handleCreateNote}
            className="p-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-md text-white transition cursor-pointer"
            title="Create Note"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-3">
          <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 text-sm focus-within:border-indigo-500/50">
            <Search className="w-4 h-4 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes..."
              className="bg-transparent border-none outline-none w-full text-slate-200 placeholder-slate-500 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Notes Feed */}
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {notes && notes.length > 0 ? (
            notes.map((note) => {
              const displayTitle =
                note.id === activeNoteId
                  ? title || 'Untitled Note'
                  : note.title || 'Untitled Note';

              return (
                <button
                  key={note.id}
                  onClick={() => setActiveNoteId(note.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition cursor-pointer flex items-center justify-between group ${
                    activeNoteId === note.id
                      ? 'bg-indigo-600/20 text-indigo-300 font-medium border border-indigo-500/30'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                >
                  <span className="truncate">{displayTitle}</span>
                </button>
              );
            })
          ) : (
            <div className="p-4 text-center text-xs text-slate-500">
              {searchQuery ? 'No notes matching query.' : 'No notes available.'}
            </div>
          )}
        </div>
      </aside>

      {/* ------------------- MIDDLE COLUMN: EDITOR & PREVIEW ------------------- */}
      <main className="flex-1 flex flex-col border-r border-slate-800 bg-slate-950">
        {activeNote || activeNoteId ? (
          <>
            {/* Editor Controls & Tab Toggle */}
            <div className="h-14 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900/30">
              <input
                type="text"
                value={title}
                onChange={handleTitleChange}
                onFocus={(e) => {
                  if (e.target.value === 'Untitled Note') {
                    e.target.select();
                  }
                }}
                className="bg-transparent text-xl font-semibold outline-none text-slate-100 placeholder-slate-600 w-1/2 focus:border-b focus:border-indigo-500/50 transition-colors pb-0.5"
                placeholder="Note Title..."
              />

              {/* Mode Switcher Buttons & Delete Action */}
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setActiveTab('edit')}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition cursor-pointer ${
                      activeTab === 'edit'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => setActiveTab('preview')}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition cursor-pointer ${
                      activeTab === 'preview'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5" /> Preview
                  </button>
                </div>

                <button
                  onClick={() => handleDeleteNote(activeNoteId)}
                  className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition cursor-pointer"
                  title="Delete Note"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Text Pane */}
            <div className="flex-1 p-6 overflow-y-auto">
              {activeTab === 'edit' ? (
                <textarea
                  value={content}
                  onChange={handleContentChange}
                  className="w-full h-full bg-transparent resize-none outline-none font-mono text-sm text-slate-300 leading-relaxed placeholder-slate-600"
                  placeholder="Write your note in Markdown... Use [[Note Title]] to create links."
                />
              ) : (
                <div
                  className="markdown-body text-slate-300 leading-relaxed max-w-none"
                  onClick={handlePreviewClick}
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(content)
                  }}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-6">
            <Network className="w-12 h-12 text-slate-800 mb-3" />
            <p className="text-base font-medium text-slate-300">No Note Selected</p>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              Create a note or select one from the sidebar to start writing.
            </p>
            <button
              onClick={handleCreateNote}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition cursor-pointer shadow-md shadow-indigo-600/30"
            >
              <Plus className="w-4 h-4" /> New Note
            </button>
          </div>
        )}
      </main>

      {/* ------------------- RIGHT COLUMN: GRAPH & BACKLINKS ------------------- */}
      <aside className="w-80 flex flex-col bg-slate-900/30">
        {/* Graph Preview Section */}
        <div className="h-1/2 border-b border-slate-800 p-4 flex flex-col">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            <Network className="w-4 h-4 text-indigo-400" /> Interactive Graph
          </div>
          <div className="flex-1 bg-slate-950 rounded-xl border border-slate-800/80 flex flex-col items-center justify-center text-slate-600 text-xs p-4 text-center">
            <Network className="w-8 h-8 text-indigo-400/40 mb-2" />
            <span className="text-slate-300 font-medium">Dexie.js Links Synced</span>
            <span className="text-[11px] text-slate-500 mt-1">
              {notes?.length || 0} notes • {totalLinksCount || 0} active links in Dexie
            </span>
          </div>
        </div>

        {/* Backlinks Panel */}
        <div className="h-1/2 p-4 flex flex-col">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-indigo-400" /> Backlinks
            </div>
            {backlinks && backlinks.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 font-mono">
                {backlinks.length}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-2">
            {backlinks && backlinks.length > 0 ? (
              backlinks.map((linkNote) => (
                <button
                  key={linkNote.id}
                  onClick={() => setActiveNoteId(linkNote.id)}
                  className="w-full text-left p-2.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/30 text-xs text-slate-300 transition cursor-pointer group"
                >
                  <div className="font-medium text-indigo-400 group-hover:text-indigo-300 flex items-center justify-between">
                    <span className="truncate">{linkNote.title}</span>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wide shrink-0 ml-1">Ref</span>
                  </div>
                  <div className="text-slate-500 line-clamp-2 mt-1 text-[11px] font-mono leading-relaxed">
                    {linkNote.content}
                  </div>
                </button>
              ))
            ) : (
              <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs text-slate-500 italic">
                {activeNote || activeNoteId
                  ? `No notes currently link to [[${currentTitle}]].`
                  : 'Select a note to view backlinks.'}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}