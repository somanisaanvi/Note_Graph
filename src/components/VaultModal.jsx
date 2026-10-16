import { 
  Folder, 
  FolderOpen, 
  RefreshCw, 
  Download, 
  Upload, 
  Trash2, 
  X, 
  HardDrive, 
  Laptop, 
  ShieldCheck, 
  AlertTriangle 
} from 'lucide-react';
import { isFileSystemAccessSupported } from '../services/fileSystemService';

export default function VaultModal({
  isOpen,
  onClose,
  vaultName,
  vaultHandle,
  notesCount,
  onOpenFolder,
  onRefreshFolder,
  onDisconnectFolder,
  onExportZip,
  onImportFiles,
  onExportNotesToFolder,
  isSyncing
}) {
  const supported = isFileSystemAccessSupported();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div 
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <Laptop className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">Local File System Vault</h2>
              <p className="text-xs text-slate-400">Directly syncs with your laptop&apos;s disk</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          {/* Status Card */}
          {vaultHandle ? (
            <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30">
              <div className="flex items-center justify-between mb-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Active Local Vault
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {notesCount} .md {notesCount === 1 ? 'file' : 'files'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-200 font-medium text-sm mt-2">
                <Folder className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="truncate">{vaultName}</span>
              </div>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                All changes, new notes, and edits are auto-saved directly as real <code className="text-emerald-300">.md</code> files inside this folder on your laptop. Compatible with Obsidian, VS Code, and GitHub!
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
                <HardDrive className="w-4 h-4" /> Browser Storage Mode (IndexedDB)
              </div>
              <p className="text-xs text-slate-400 leading-relaxed mt-1">
                Your notes are currently saved in browser IndexedDB cache. Connect a real folder on your laptop so your markdown files persist on disk and never disappear if you change browsers.
              </p>
            </div>
          )}

          {/* Browser compatibility alert if not supported */}
          {!supported && (
            <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-300 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Local File System Access API</p>
                <p className="text-slate-300 mt-0.5">
                  Direct folder access is supported natively in Chrome, Edge, Brave, and Chromium browsers. On other browsers, use the <strong>Download ZIP</strong> or <strong>Import Markdown</strong> buttons below.
                </p>
              </div>
            </div>
          )}

          {/* Actions Section */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">
              Folder Actions
            </h3>

            {supported && (
              <button
                onClick={() => {
                  onClose();
                  onOpenFolder();
                }}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition cursor-pointer shadow-md shadow-indigo-600/30 group"
              >
                <span className="flex items-center gap-2.5">
                  <FolderOpen className="w-4 h-4 text-indigo-200 group-hover:scale-110 transition-transform" />
                  <span>{vaultHandle ? 'Switch to Another Local Folder' : 'Connect a Local Folder from Laptop'}</span>
                </span>
                <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-mono">
                  showDirectoryPicker
                </span>
              </button>
            )}

            {vaultHandle && (
              <>
                <button
                  onClick={onRefreshFolder}
                  disabled={isSyncing}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 text-xs transition cursor-pointer border border-slate-700/50"
                >
                  <span className="flex items-center gap-2.5">
                    <RefreshCw className={`w-4 h-4 text-indigo-400 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>Scan & Refresh Files from Laptop Disk</span>
                  </span>
                  <span className="text-[10px] text-slate-400">Sync external edits</span>
                </button>

                <button
                  onClick={onExportNotesToFolder}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 text-xs transition cursor-pointer border border-slate-700/50"
                >
                  <span className="flex items-center gap-2.5">
                    <Upload className="w-4 h-4 text-emerald-400" />
                    <span>Copy All Current Notes into Connected Folder</span>
                  </span>
                  <span className="text-[10px] text-slate-400">Ensure disk has all files</span>
                </button>

                <button
                  onClick={() => {
                    onDisconnectFolder();
                    onClose();
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-rose-950/20 hover:bg-rose-950/40 text-rose-300 text-xs transition cursor-pointer border border-rose-500/30"
                >
                  <span className="flex items-center gap-2.5">
                    <Trash2 className="w-4 h-4 text-rose-400" />
                    <span>Disconnect Local Folder</span>
                  </span>
                  <span className="text-[10px] text-rose-400/80">Revert to IndexedDB</span>
                </button>
              </>
            )}
          </div>

          {/* Backup & Portability Section */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">
              Backup & Portability
            </h3>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={onExportZip}
                className="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-slate-800/70 hover:bg-slate-700/70 text-slate-300 text-xs font-medium transition cursor-pointer border border-slate-700/50"
                title="Download all notes as a .zip of markdown files"
              >
                <Download className="w-3.5 h-3.5 text-indigo-400" />
                <span>Export as .ZIP</span>
              </button>

              <label className="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-slate-800/70 hover:bg-slate-700/70 text-slate-300 text-xs font-medium transition cursor-pointer border border-slate-700/50">
                <Upload className="w-3.5 h-3.5 text-indigo-400" />
                <span>Import .MD Files</span>
                <input
                  type="file"
                  multiple
                  accept=".md,.markdown,text/markdown,text/plain"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      onImportFiles(e.target.files);
                      e.target.value = '';
                    }
                  }}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Files remain 100% private on your device</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
