// src/App.jsx
import React, { useState } from 'react';
import { Plus, BookOpen, Edit3, Network, ArrowLeftRight, Search } from 'lucide-react';

export default function App() {
  // Dummy State for Layout Testing
  const [notes, setNotes] = useState([
    { id: 1, title: 'Project Ideas', content: 'Building a [[PWA Knowledge Base]]' },
    { id: 2, title: 'PWA Knowledge Base', content: 'Uses [[IndexedDB]] and [[D3.js]] for graph visualization.' }
  ]);
  const [activeNoteId, setActiveNoteId] = useState(1);
  const [activeTab, setActiveTab] = useState('edit'); // 'edit' | 'preview'

  const activeNote = notes.find((n) => n.id === activeNoteId);

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">

      {/* ------------------- LEFT COLUMN: NOTE LIST ------------------- */}
      <aside className="w-64 border-r border-slate-800 flex flex-col bg-slate-900/50">
        {/* App Title Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg text-indigo-400">
            <Network className="w-5 h-5" />
            <span>NoteGraph</span>
          </div>
          <button
            className="p-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-md text-white transition cursor-pointer"
            title="Create Note"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-3">
          <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 text-sm">
            <Search className="w-4 h-4" />
            <input
              type="text"
              placeholder="Search notes..."
              className="bg-transparent border-none outline-none w-full text-slate-200 placeholder-slate-500"
            />
          </div>
        </div>

        {/* Notes Feed */}
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {notes.map((note) => (
            <button
              key={note.id}
              onClick={() => setActiveNoteId(note.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition cursor-pointer ${activeNoteId === note.id
                ? 'bg-indigo-600/20 text-indigo-300 font-medium border border-indigo-500/30'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
            >
              {note.title}
            </button>
          ))}
        </div>
      </aside>

      {/* ------------------- MIDDLE COLUMN: EDITOR & PREVIEW ------------------- */}
      <main className="flex-1 flex flex-col border-r border-slate-800 bg-slate-950">
        {/* Editor Controls & Tab Toggle */}
        <div className="h-14 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900/30">
          <input
            type="text"
            value={activeNote?.title || ''}
            onChange={(e) => {
              const newTitle = e.target.value;
              setNotes(notes.map(n => n.id === activeNoteId ? { ...n, title: newTitle } : n));
            }}
            className="bg-transparent text-xl font-semibold outline-none text-slate-100 placeholder-slate-600 w-1/2"
            placeholder="Note Title..."
          />

          {/* Mode Switcher Buttons */}
          <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setActiveTab('edit')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition cursor-pointer ${activeTab === 'edit' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
            >
              <Edit3 className="w-3.5 h-3.5" /> Edit
            </button>
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition cursor-pointer ${activeTab === 'preview' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
            >
              <BookOpen className="w-3.5 h-3.5" /> Preview
            </button>
          </div>
        </div>

        {/* Text Pane */}
        <div className="flex-1 p-6">
          {activeTab === 'edit' ? (
            <textarea
              value={activeNote?.content || ''}
              onChange={(e) => {
                const newContent = e.target.value;
                setNotes(notes.map(n => n.id === activeNoteId ? { ...n, content: newContent } : n));
              }}
              className="w-full h-full bg-transparent resize-none outline-none font-mono text-sm text-slate-300 leading-relaxed placeholder-slate-600"
              placeholder="Write your note in Markdown... Use [[Note Title]] to create links."
            />
          ) : (
            <div className="prose prose-invert max-w-none text-slate-300">
              <p className="whitespace-pre-wrap">{activeNote?.content}</p>
            </div>
          )}
        </div>
      </main>

      {/* ------------------- RIGHT COLUMN: GRAPH & BACKLINKS ------------------- */}
      <aside className="w-80 flex flex-col bg-slate-900/30">
        {/* Graph Preview Section */}
        <div className="h-1/2 border-b border-slate-800 p-4 flex flex-col">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            <Network className="w-4 h-4 text-indigo-400" /> Interactive Graph
          </div>
          <div className="flex-1 bg-slate-950 rounded-xl border border-slate-800/80 flex items-center justify-center text-slate-600 text-xs">
            [ D3 Graph Simulation Placeholder ]
          </div>
        </div>

        {/* Backlinks Panel */}
        <div className="h-1/2 p-4 flex flex-col">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            <ArrowLeftRight className="w-4 h-4 text-indigo-400" /> Backlinks
          </div>
          <div className="flex-1 overflow-y-auto space-y-2">
            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs text-slate-400">
              Notes referencing this will appear here automatically.
            </div>
          </div>
        </div>
      </aside>

    </div>
  );
}