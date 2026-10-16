import JSZip from 'jszip';

/**
 * Check if the browser supports the File System Access API
 */
export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Sanitize note title to be a valid, safe filename across Windows, Mac, and Linux
 * Removes illegal characters: / \ : * ? " < > |
 * @param {string} title
 * @returns {string} Safe file name with .md extension
 */
export function sanitizeFileName(title) {
  if (!title || !title.trim()) {
    return 'Untitled Note.md';
  }
  // Replace illegal filename characters
  let clean = title.trim().replace(/[\\/:*?"<>|]/g, '-');
  // Avoid leading or trailing dots or spaces
  clean = clean.replace(/^[.\s]+|[.\s]+$/g, '');
  if (!clean) {
    clean = 'Untitled Note';
  }
  // Truncate to reasonable length
  if (clean.length > 200) {
    clean = clean.substring(0, 200).trim();
  }
  return clean.toLowerCase().endsWith('.md') ? clean : `${clean}.md`;
}

/**
 * Extract clean note title from a filename (removes .md/.markdown extension)
 * @param {string} fileName
 * @returns {string}
 */
export function getTitleFromFileName(fileName) {
  if (!fileName) return 'Untitled Note';
  return fileName.replace(/\.(md|markdown)$/i, '');
}

/**
 * Native IndexedDB storage for FileSystemDirectoryHandle
 * Preserves directory permissions and handle across page reloads
 */
const IDB_NAME = 'NoteGraphVaultHandles';
const STORE_NAME = 'handles';

function getHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeVaultHandle(handle) {
  try {
    const db = await getHandleDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(
        {
          id: 'currentVault',
          name: handle.name,
          handle: handle,
          savedAt: new Date().toISOString()
        },
        'currentVault'
      );
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Failed to store directory handle in IndexedDB:', err);
    return false;
  }
}

export async function getStoredVaultHandle() {
  try {
    const db = await getHandleDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get('currentVault');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to retrieve stored directory handle:', err);
    return null;
  }
}

export async function clearStoredVaultHandle() {
  try {
    const db = await getHandleDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete('currentVault');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Failed to clear directory handle from IndexedDB:', err);
  }
}

/**
 * Verify or request permission on a directory handle
 * @param {FileSystemDirectoryHandle} handle
 * @param {boolean} requestIfNeeded
 * @returns {Promise<'granted' | 'prompt' | 'denied'>}
 */
export async function verifyDirectoryPermission(handle, requestIfNeeded = false) {
  if (!handle) return 'denied';
  const opts = { mode: 'readwrite' };
  try {
    const status = await handle.queryPermission(opts);
    if (status === 'granted') {
      return 'granted';
    }
    if (requestIfNeeded) {
      const requestStatus = await handle.requestPermission(opts);
      return requestStatus;
    }
    return status;
  } catch (err) {
    console.warn('Error querying permission for handle:', err);
    return 'denied';
  }
}

/**
 * Open local directory picker dialog
 * @returns {Promise<FileSystemDirectoryHandle | null>}
 */
export async function openLocalDirectory() {
  if (!isFileSystemAccessSupported()) {
    throw new Error('File System Access API is not supported in this browser.');
  }

  try {
    const dirHandle = await window.showDirectoryPicker({
      id: 'notegraph_vault',
      mode: 'readwrite',
      startIn: 'documents'
    });
    return dirHandle;
  } catch (err) {
    if (err.name === 'AbortError') {
      // User cancelled picker dialog
      return null;
    }
    throw err;
  }
}

/**
 * Read all markdown files from a local directory
 * Scans root and 1 level of subdirectories, ignoring hidden/internal folders
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<Array<{ title: string, content: string, fileName: string, path: string, updatedAt: string }>>}
 */
export async function readMarkdownFilesFromDirectory(dirHandle) {
  if (!dirHandle) return [];
  const notes = [];

  const ignoreDirs = new Set(['.git', '.obsidian', 'node_modules', '.trash', '.vscode', '.idea']);

  async function scanDirectory(currentHandle, currentPath = '') {
    for await (const entry of currentHandle.values()) {
      if (entry.name.startsWith('.')) continue; // skip hidden files

      if (entry.kind === 'file') {
        const lowerName = entry.name.toLowerCase();
        if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
          try {
            const file = await entry.getFile();
            const content = await file.text();
            const noteTitle = getTitleFromFileName(entry.name);
            const relativePath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
            const updatedAt = file.lastModified
              ? new Date(file.lastModified).toISOString()
              : new Date().toISOString();

            notes.push({
              title: noteTitle,
              content: content,
              fileName: entry.name,
              relativePath: relativePath,
              updatedAt: updatedAt,
              createdAt: updatedAt
            });
          } catch (err) {
            console.error(`Error reading file ${entry.name}:`, err);
          }
        }
      } else if (entry.kind === 'directory' && !ignoreDirs.has(entry.name)) {
        // Scan subdirectories (1 level or flat)
        try {
          await scanDirectory(entry, currentPath ? `${currentPath}/${entry.name}` : entry.name);
        } catch (err) {
          console.warn(`Could not scan directory ${entry.name}:`, err);
        }
      }
    }
  }

  await scanDirectory(dirHandle);
  return notes;
}

/**
 * Write or update a markdown file in the directory
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} fileName
 * @param {string} content
 */
export async function writeMarkdownFile(dirHandle, fileName, content) {
  if (!dirHandle || !fileName) return false;
  try {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  } catch (err) {
    console.error(`Error writing file ${fileName}:`, err);
    throw err;
  }
}

/**
 * Safely rename a file in the directory
 * Supports fileHandle.move() if available, otherwise creates new file & deletes old
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} oldFileName
 * @param {string} newFileName
 * @param {string} content
 */
export async function renameMarkdownFile(dirHandle, oldFileName, newFileName, content) {
  if (!dirHandle || !oldFileName || !newFileName) return;
  if (oldFileName === newFileName) {
    await writeMarkdownFile(dirHandle, newFileName, content);
    return;
  }

  try {
    const oldFileHandle = await dirHandle.getFileHandle(oldFileName);
    if ('move' in oldFileHandle && typeof oldFileHandle.move === 'function') {
      await oldFileHandle.move(newFileName);
      // Ensure latest content is written
      await writeMarkdownFile(dirHandle, newFileName, content);
      return;
    }
  } catch {
    // If getting old handle fails, fall through to create new file
  }

  // Fallback: create new file and delete old file
  await writeMarkdownFile(dirHandle, newFileName, content);
  try {
    await dirHandle.removeEntry(oldFileName);
  } catch (err) {
    console.warn(`Could not remove old file ${oldFileName} during rename:`, err);
  }
}

/**
 * Delete a markdown file from the directory
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} fileName
 */
export async function deleteMarkdownFile(dirHandle, fileName) {
  if (!dirHandle || !fileName) return false;
  try {
    await dirHandle.removeEntry(fileName);
    return true;
  } catch (err) {
    console.error(`Error deleting file ${fileName}:`, err);
    throw err;
  }
}

/**
 * Export all given notes to the selected directory as .md files
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {Array<{ title: string, content: string }>} notes
 * @returns {Promise<number>} count of exported notes
 */
export async function exportNotesToDirectory(dirHandle, notes) {
  if (!dirHandle || !notes || notes.length === 0) return 0;
  let count = 0;
  for (const note of notes) {
    const fileName = note.fileName || sanitizeFileName(note.title);
    const content = note.content || `# ${note.title || 'Untitled Note'}\n\n`;
    try {
      await writeMarkdownFile(dirHandle, fileName, content);
      count++;
    } catch (err) {
      console.error(`Failed to export note "${note.title}" to directory:`, err);
    }
  }
  return count;
}

/**
 * Universal Fallback: Download all notes as a single ZIP archive containing .md files
 * Works on any browser (Firefox, Safari, Mobile, Chrome)
 * @param {Array<{ title: string, content: string, fileName?: string }>} notes
 * @param {string} archiveName
 */
export async function downloadNotesZipArchive(notes, archiveName = 'NoteGraph_Vault.zip') {
  if (!notes || notes.length === 0) return;
  const zip = new JSZip();

  const usedNames = new Set();
  for (const note of notes) {
    let name = note.fileName || sanitizeFileName(note.title);
    // Ensure unique file names in the zip
    if (usedNames.has(name)) {
      const base = name.replace(/\.md$/i, '');
      let i = 1;
      while (usedNames.has(`${base}_${i}.md`)) {
        i++;
      }
      name = `${base}_${i}.md`;
    }
    usedNames.add(name);

    const content = note.content || `# ${note.title || 'Untitled Note'}\n\n`;
    zip.file(name, content);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = archiveName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read uploaded markdown files from an HTML file input
 * @param {FileList | File[]} fileList
 * @returns {Promise<Array<{ title: string, content: string, fileName: string }>>}
 */
export async function readUploadedMarkdownFiles(fileList) {
  if (!fileList || fileList.length === 0) return [];
  const results = [];

  for (const file of fileList) {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown') || file.type === 'text/markdown' || file.type === 'text/plain') {
      try {
        const text = await file.text();
        results.push({
          title: getTitleFromFileName(file.name),
          content: text,
          fileName: sanitizeFileName(file.name),
          updatedAt: new Date(file.lastModified || Date.now()).toISOString(),
          createdAt: new Date().toISOString()
        });
      } catch (e) {
        console.error(`Error reading uploaded file ${file.name}:`, e);
      }
    }
  }

  return results;
}
