import { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  BookOpen, 
  Edit3, 
  Network, 
  Search, 
  Trash2, 
  Folder, 
  FolderOpen, 
  RefreshCw, 
  Check, 
  HardDrive, 
  Laptop, 
  ChevronDown, 
  AlertCircle, 
  Settings
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { marked } from 'marked';
import InteractiveGraph from './components/InteractiveGraph';
import { 
  db, 
  createNote, 
  updateNote, 
  deleteNote, 
  ensureInitialNotes, 
  replaceNotesFromFolder, 
  WIKI_LINK_REGEX 
} from './db';
import StartPage from './components/StartPage';
import VaultModal from './components/VaultModal';
import {
  isFileSystemAccessSupported,
  sanitizeFileName,
  openLocalDirectory,
  readMarkdownFilesFromDirectory,
  writeMarkdownFile,
  renameMarkdownFile,
  deleteMarkdownFile,
  exportNotesToDirectory,
  storeVaultHandle,
  getStoredVaultHandle,
  clearStoredVaultHandle,
  verifyDirectoryPermission,
  downloadNotesZipArchive,
  readUploadedMarkdownFiles
} from './services/fileSystemService';

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

  // Local File System Vault state
  const [vaultHandle, setVaultHandle] = useState(null);
  const [vaultName, setVaultName] = useState('');
  const [savedVaultInfo, setSavedVaultInfo] = useState(null);
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [saveMessage, setSaveMessage] = useState('');

  // Toast feedback state
  const [toast, setToast] = useState(null);

  // References to preserve state during debouncing and note switches
  const saveTimeoutRef = useRef(null);
  const activeNoteRef = useRef(null);
  const titleRef = useRef('');
  const contentRef = useRef('');
  const vaultHandleRef = useRef(null);
  const vaultNameRef = useRef('');

  // Helper to show floating toast notifications
  const showToast = (message, type = 'info', duration = 3500) => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr && curr.message === message ? null : curr));
    }, duration);
  };

  // Attempt to restore saved local folder vault on initial app load
  useEffect(() => {
    async function initStorage() {
      if (isFileSystemAccessSupported()) {
        try {
          const stored = await getStoredVaultHandle();
          if (stored && stored.handle) {
            const status = await verifyDirectoryPermission(stored.handle, false);
            if (status === 'granted') {
              // Permission already active, auto-load directory files!
              setIsSyncing(true);
              const files = await readMarkdownFilesFromDirectory(stored.handle);
              if (files.length > 0) {
                await replaceNotesFromFolder(files);
              }
              setVaultHandle(stored.handle);
              setVaultName(stored.name);
              setIsSyncing(false);
              return;
            } else {
              // Permission prompt required (needs user activation click)
              setSavedVaultInfo({ name: stored.name, handle: stored.handle });
              return;
            }
          }
        } catch (err) {
          console.warn('Could not restore saved vault handle:', err);
        }
      }

      // Fallback: Ensure initial seed notes exist in browser storage
      ensureInitialNotes();
    }

    initStorage();
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

  // Keep references synced for background debounced saves
  useEffect(() => {
    activeNoteRef.current = activeNote;
    titleRef.current = title;
    contentRef.current = content;
    vaultHandleRef.current = vaultHandle;
    vaultNameRef.current = vaultName;
  });

  // Synchronize local input buffers when switching to a different note
  useEffect(() => {
    const note = notes?.find((n) => n.id === activeNoteId);
    if (note) {
      setTitle(note.title ?? '');
      setContent(note.content ?? '');
      setSaveStatus('idle');
      setSaveMessage(vaultHandle ? `${vaultName}/${note.fileName || sanitizeFileName(note.title)}` : '');
    } else {
      setTitle('');
      setContent('');
      setSaveStatus('idle');
      setSaveMessage('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId]);

  const currentTitle = title.trim() || activeNote?.title || '';

  // Flush any pending debounced disk save immediately
  const flushPendingSave = async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
      if (vaultHandleRef.current && activeNoteRef.current) {
        try {
          const handle = vaultHandleRef.current;
          const note = activeNoteRef.current;
          const currentFileName = note.fileName || sanitizeFileName(note.title);
          const newFileName = sanitizeFileName(titleRef.current || 'Untitled Note');

          if (currentFileName !== newFileName) {
            await renameMarkdownFile(handle, currentFileName, newFileName, contentRef.current);
            await updateNote(note.id, { fileName: newFileName });
          } else {
            await writeMarkdownFile(handle, currentFileName, contentRef.current);
          }
          setSaveStatus('saved');
        } catch (e) {
          console.error('Error during flush save:', e);
        }
      }
    }
  };

  // Debounced auto-save directly to local .md file on disk
  const triggerDiskSave = (currentTitleVal, currentContentVal) => {
    if (!vaultHandleRef.current || !activeNoteRef.current) return;

    setSaveStatus('saving');
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const handle = vaultHandleRef.current;
        const note = activeNoteRef.current;
        if (!handle || !note) return;

        const currentFileName = note.fileName || sanitizeFileName(note.title);
        const newFileName = sanitizeFileName(currentTitleVal || 'Untitled Note');

        if (currentFileName !== newFileName) {
          // Note title changed: rename file on laptop storage
          await renameMarkdownFile(handle, currentFileName, newFileName, currentContentVal);
          await updateNote(note.id, { fileName: newFileName });
        } else {
          // File content changed: write updated markdown
          await writeMarkdownFile(handle, currentFileName, currentContentVal);
        }

        setSaveStatus('saved');
        setSaveMessage(`${vaultNameRef.current}/${newFileName}`);
      } catch (err) {
        console.error('Disk save failed:', err);
        setSaveStatus('error');
        setSaveMessage('Save failed');
      }
    }, 450);
  };

  // Switch active note with flush protection
  const handleSelectNote = async (noteId) => {
    if (noteId === activeNoteId) return;
    await flushPendingSave();
    setActiveNoteId(noteId);
  };

  // Create a new note
  const handleCreateNote = async () => {
    await flushPendingSave();
    let uniqueTitle = 'Untitled Note';
    let baseFileName = sanitizeFileName(uniqueTitle);

    if (vaultHandle) {
      // Find a unique filename on laptop disk
      const existingNames = new Set(
        (notes || []).map((n) => n.fileName || sanitizeFileName(n.title))
      );
      let counter = 1;
      while (existingNames.has(baseFileName)) {
        uniqueTitle = `Untitled Note ${counter}`;
        baseFileName = sanitizeFileName(uniqueTitle);
        counter++;
      }

      const initialText = `# ${uniqueTitle}\n\n`;
      try {
        await writeMarkdownFile(vaultHandle, baseFileName, initialText);
      } catch (err) {
        console.error('Could not create file on disk:', err);
      }

      const id = await createNote(uniqueTitle, initialText, { fileName: baseFileName });
      setActiveNoteId(id);
      setTitle(uniqueTitle);
      setContent(initialText);
      setActiveTab('edit');
      setSaveStatus('saved');
      setSaveMessage(`${vaultName}/${baseFileName}`);
      showToast(`Created ${baseFileName} on laptop storage`, 'success');
    } else {
      const id = await createNote(uniqueTitle, '');
      setActiveNoteId(id);
      setTitle(uniqueTitle);
      setContent('');
      setActiveTab('edit');
    }
  };

  // Delete note
  const handleDeleteNote = async (idToDelete) => {
    if (!idToDelete) return;
    const noteToDelete = notes?.find((n) => n.id === idToDelete);
    if (noteToDelete && vaultHandle) {
      const fileName = noteToDelete.fileName || sanitizeFileName(noteToDelete.title);
      try {
        await deleteMarkdownFile(vaultHandle, fileName);
        showToast(`Deleted ${fileName} from laptop disk`, 'info');
      } catch (err) {
        console.warn('Could not delete file from disk:', err);
      }
    }

    await deleteNote(idToDelete);
    if (activeNoteId === idToDelete) {
      const remaining = notes.filter((n) => n.id !== idToDelete);
      setActiveNoteId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  // Note Title change handler
  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    titleRef.current = newTitle;
    if (activeNoteId) {
      updateNote(activeNoteId, { title: newTitle });
    }
    triggerDiskSave(newTitle, content);
  };

  // Note Content change handler
  const handleContentChange = (e) => {
    const newContent = e.target.value;
    setContent(newContent);
    contentRef.current = newContent;
    if (activeNoteId) {
      updateNote(activeNoteId, { content: newContent });
    }
    triggerDiskSave(title, newContent);
  };

  // Open Local Folder via File System Access API
  const handleOpenLocalFolder = async () => {
    try {
      const dirHandle = await openLocalDirectory();
      if (!dirHandle) return; // user cancelled dialog

      await storeVaultHandle(dirHandle);
      setIsSyncing(true);
      const diskNotes = await readMarkdownFilesFromDirectory(dirHandle);

      if (diskNotes.length > 0) {
        const stored = await replaceNotesFromFolder(diskNotes);
        setVaultHandle(dirHandle);
        setVaultName(dirHandle.name);
        setSavedVaultInfo(null);
        setCurrentPage('workspace');
        if (stored.length > 0) {
          setActiveNoteId(stored[0].id);
        }
        showToast(`Connected to "${dirHandle.name}" (${diskNotes.length} notes loaded)`, 'success');
      } else {
        // Folder is currently empty
        const currentNotes = await db.notes.toArray();
        if (currentNotes.length > 0) {
          // Auto-export existing notes to populate the new folder
          const count = await exportNotesToDirectory(dirHandle, currentNotes);
          const reloaded = await readMarkdownFilesFromDirectory(dirHandle);
          const stored = await replaceNotesFromFolder(reloaded);
          setVaultHandle(dirHandle);
          setVaultName(dirHandle.name);
          setSavedVaultInfo(null);
          setCurrentPage('workspace');
          if (stored.length > 0) {
            setActiveNoteId(stored[0].id);
          }
          showToast(`Connected to "${dirHandle.name}". Exported ${count} notes as .md files!`, 'success');
        } else {
          // Initialize first note in empty folder
          const welcomeTitle = 'Welcome';
          const welcomeFileName = 'Welcome.md';
          const welcomeContent = `# Welcome to NoteGraph\n\nThis note is stored directly on your laptop's disk inside the **${dirHandle.name}** folder as a standard \`.md\` file.\n\n### Features\n- Every keystroke is saved directly to your laptop\n- Compatible with Obsidian, VS Code, and OneDrive/GitHub\n- Double-bracket [[wiki links]] create instant bi-directional graph connections!`;
          await writeMarkdownFile(dirHandle, welcomeFileName, welcomeContent);
          const stored = await replaceNotesFromFolder([
            { title: welcomeTitle, fileName: welcomeFileName, content: welcomeContent }
          ]);
          setVaultHandle(dirHandle);
          setVaultName(dirHandle.name);
          setSavedVaultInfo(null);
          setCurrentPage('workspace');
          if (stored.length > 0) {
            setActiveNoteId(stored[0].id);
          }
          showToast(`Connected to "${dirHandle.name}"!`, 'success');
        }
      }
    } catch (err) {
      console.error('Error opening local folder:', err);
      showToast('Could not open folder: ' + err.message, 'warning');
    } finally {
      setIsSyncing(false);
    }
  };

  // Reconnect saved vault with 1-click user permission activation
  const handleReconnectVault = async () => {
    if (!savedVaultInfo || !savedVaultInfo.handle) return;
    try {
      setIsSyncing(true);
      const permission = await verifyDirectoryPermission(savedVaultInfo.handle, true);
      if (permission === 'granted') {
        const diskNotes = await readMarkdownFilesFromDirectory(savedVaultInfo.handle);
        const stored = await replaceNotesFromFolder(diskNotes);
        setVaultHandle(savedVaultInfo.handle);
        setVaultName(savedVaultInfo.name);
        setSavedVaultInfo(null);
        setCurrentPage('workspace');
        if (stored.length > 0) {
          setActiveNoteId(stored[0].id);
        }
        showToast(`Reconnected to "${savedVaultInfo.name}" (${diskNotes.length} notes)`, 'success');
      } else {
        showToast('Permission to access folder was not granted.', 'warning');
      }
    } catch (err) {
      console.error('Error reconnecting vault:', err);
      showToast('Failed to reconnect vault: ' + err.message, 'warning');
    } finally {
      setIsSyncing(false);
    }
  };

  // Refresh / Scan folder on laptop disk for external edits
  const handleRefreshFolder = async () => {
    if (!vaultHandle) return;
    try {
      setIsSyncing(true);
      await flushPendingSave();
      const diskNotes = await readMarkdownFilesFromDirectory(vaultHandle);
      const currentActiveTitle = activeNote?.title;
      const stored = await replaceNotesFromFolder(diskNotes);

      // Restore active note if it still exists
      const match = stored.find((n) => n.title === currentActiveTitle);
      if (match) {
        setActiveNoteId(match.id);
      } else if (stored.length > 0) {
        setActiveNoteId(stored[0].id);
      } else {
        setActiveNoteId(null);
      }

      showToast(`Refreshed ${diskNotes.length} notes from laptop storage`, 'info');
    } catch (err) {
      console.error('Error refreshing folder:', err);
      showToast('Error refreshing folder: ' + err.message, 'warning');
    } finally {
      setIsSyncing(false);
    }
  };

  // Disconnect folder and switch back to browser storage
  const handleDisconnectFolder = async () => {
    await flushPendingSave();
    await clearStoredVaultHandle();
    setVaultHandle(null);
    setVaultName('');
    setSavedVaultInfo(null);
    showToast('Disconnected local folder. Switched to browser storage.', 'info');
  };

  // Export current notes to the connected folder
  const handleExportNotesToFolder = async () => {
    if (!vaultHandle || !notes || notes.length === 0) return;
    try {
      setIsSyncing(true);
      const count = await exportNotesToDirectory(vaultHandle, notes);
      showToast(`Exported ${count} notes into "${vaultName}" folder`, 'success');
    } catch (err) {
      showToast('Export failed: ' + err.message, 'warning');
    } finally {
      setIsSyncing(false);
    }
  };

  // Export all notes as a ZIP file (universal backup)
  const handleExportZip = async () => {
    if (!notes || notes.length === 0) {
      showToast('No notes to export', 'warning');
      return;
    }
    try {
      await downloadNotesZipArchive(notes, `${vaultName || 'NoteGraph'}_Vault.zip`);
      showToast(`Exported ${notes.length} notes to ZIP archive`, 'success');
    } catch (err) {
      showToast('ZIP export failed: ' + err.message, 'warning');
    }
  };

  // Import markdown files from laptop
  const handleImportFiles = async (fileList) => {
    try {
      const parsedFiles = await readUploadedMarkdownFiles(fileList);
      if (parsedFiles.length === 0) {
        showToast('No valid markdown (.md) files found in selection', 'warning');
        return;
      }

      for (const item of parsedFiles) {
        if (vaultHandle) {
          await writeMarkdownFile(vaultHandle, item.fileName, item.content);
        }
        await createNote(item.title, item.content, { fileName: item.fileName });
      }

      showToast(`Imported ${parsedFiles.length} markdown notes!`, 'success');
    } catch (err) {
      showToast('Import failed: ' + err.message, 'warning');
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
        handleSelectNote(targetNote.id);
      }
    }
  };

  if (currentPage === 'start') {
    return (
      <StartPage 
        onContinue={() => setCurrentPage('workspace')} 
        onOpenVault={handleOpenLocalFolder}
        savedVaultName={savedVaultInfo?.name}
        onReconnectVault={handleReconnectVault}
      />
    );
  }

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden select-none">
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
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowVaultModal(true)}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition cursor-pointer"
              title="Vault & Folder Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={handleCreateNote}
              className="p-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-md text-white transition cursor-pointer shadow-sm shadow-indigo-600/30"
              title="Create Note"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Local Folder / Vault Status Pill */}
        <div className="px-3 pt-3 pb-1">
          {vaultHandle ? (
            <div className="p-2.5 rounded-xl bg-emerald-950/25 border border-emerald-500/30 flex items-center justify-between group">
              <div 
                className="flex items-center gap-2 min-w-0 cursor-pointer"
                onClick={() => setShowVaultModal(true)}
                title={`Connected to local folder: ${vaultName}`}
              >
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <div className="truncate">
                  <div className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5 truncate">
                    <Folder className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{vaultName}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">Saved on laptop disk</div>
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={handleRefreshFolder}
                  disabled={isSyncing}
                  className="p-1 text-slate-400 hover:text-emerald-300 rounded transition cursor-pointer"
                  title="Rescan folder for external edits"
                >
                  <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin text-emerald-400' : ''}`} />
                </button>
                <button
                  onClick={() => setShowVaultModal(true)}
                  className="p-1 text-slate-400 hover:text-slate-200 rounded transition cursor-pointer"
                  title="Vault Settings"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
            </div>
          ) : savedVaultInfo ? (
            <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/40 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-amber-300 truncate">
                  Reconnect {savedVaultInfo.name}
                </div>
                <div className="text-[10px] text-slate-400">Requires 1-click permission</div>
              </div>
              <button
                onClick={handleReconnectVault}
                className="px-2.5 py-1 text-[11px] bg-amber-600 hover:bg-amber-500 text-white rounded-md font-medium transition cursor-pointer shrink-0"
              >
                Connect
              </button>
            </div>
          ) : (
            <button
              onClick={handleOpenLocalFolder}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-xs transition cursor-pointer group"
              title="Connect a local folder so notes are saved directly as .md files on your computer"
            >
              <span className="flex items-center gap-2 truncate">
                <FolderOpen className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform shrink-0" />
                <span className="font-medium truncate">Connect Laptop Folder</span>
              </span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 rounded shrink-0">
                Local
              </span>
            </button>
          )}
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
                  onClick={() => handleSelectNote(note.id)}
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

        {/* Bottom Sidebar Footer */}
        <div className="p-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
          <span className="truncate">
            {notes?.length || 0} {notes?.length === 1 ? 'note' : 'notes'}
          </span>
          <button
            onClick={() => setShowVaultModal(true)}
            className="hover:text-indigo-400 transition cursor-pointer flex items-center gap-1"
          >
            <Laptop className="w-3 h-3" />
            <span>Vault Info</span>
          </button>
        </div>
      </aside>

      {/* ------------------- MIDDLE COLUMN: EDITOR & PREVIEW ------------------- */}
      <main className="flex-1 flex flex-col border-r border-slate-800 bg-slate-950">
        {activeNote || activeNoteId ? (
          <>
            {/* Editor Controls & Tab Toggle */}
            <div className="h-14 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900/30">
              <div className="flex items-center gap-3 w-1/2">
                <input
                  type="text"
                  value={title}
                  onChange={handleTitleChange}
                  onFocus={(e) => {
                    if (e.target.value === 'Untitled Note') {
                      e.target.select();
                    }
                  }}
                  className="bg-transparent text-xl font-semibold outline-none text-slate-100 placeholder-slate-600 w-full focus:border-b focus:border-indigo-500/50 transition-colors pb-0.5"
                  placeholder="Note Title..."
                />
              </div>

              {/* Status Indicator & Tab Toggle */}
              <div className="flex items-center gap-3">
                {/* Real-time Local Disk Save Status Indicator */}
                {vaultHandle ? (
                  <div className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-slate-400">
                    {saveStatus === 'saving' ? (
                      <span className="flex items-center gap-1.5 text-indigo-400">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Saving to disk...</span>
                      </span>
                    ) : saveStatus === 'saved' ? (
                      <span className="flex items-center gap-1.5 text-emerald-400 truncate max-w-[220px]" title={saveMessage}>
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate text-slate-400">{saveMessage || 'Saved to disk'}</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-slate-500 truncate max-w-[180px]">
                        <HardDrive className="w-3 h-3 text-slate-500 shrink-0" />
                        <span className="truncate">{activeNote?.fileName || `${currentTitle}.md`}</span>
                      </span>
                    )}
                  </div>
                ) : null}

                {/* Mode Switcher Buttons */}
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
                  className="w-full h-full bg-transparent resize-none outline-none font-mono text-sm text-slate-300 leading-relaxed placeholder-slate-600 select-text"
                  placeholder="Write your note in Markdown... Use [[Note Title]] to create links."
                />
              ) : (
                <div
                  className="markdown-body text-slate-300 leading-relaxed max-w-none select-text"
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

      {/* ------------------- RIGHT COLUMN: INTERACTIVE GRAPH ------------------- */}
      <aside className="w-80 lg:w-96 shrink-0 flex flex-col border-l border-slate-800 bg-slate-900/30">
        <InteractiveGraph
          activeNoteId={activeNoteId}
          onSelectNote={handleSelectNote}
          vaultHandle={vaultHandle}
        />
      </aside>

      {/* Vault Management Dialog Modal */}
      <VaultModal
        isOpen={showVaultModal}
        onClose={() => setShowVaultModal(false)}
        vaultName={vaultName}
        vaultHandle={vaultHandle}
        notesCount={notes?.length || 0}
        onOpenFolder={handleOpenLocalFolder}
        onRefreshFolder={handleRefreshFolder}
        onDisconnectFolder={handleDisconnectFolder}
        onExportZip={handleExportZip}
        onImportFiles={handleImportFiles}
        onExportNotesToFolder={handleExportNotesToFolder}
        isSyncing={isSyncing}
      />

      {/* Floating Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-slate-900/95 border border-indigo-500/40 text-slate-100 text-xs shadow-2xl backdrop-blur-md animate-bounce-in">
          {toast.type === 'success' ? (
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : toast.type === 'warning' ? (
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-indigo-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}