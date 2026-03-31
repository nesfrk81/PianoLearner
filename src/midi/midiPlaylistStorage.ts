/** IndexedDB holds MIDI binary data; localStorage holds playlist order + current id. */

const DB_NAME = 'piano-learner-midi-cache'
const DB_VERSION = 1
const STORE = 'midiFiles'
const LS_KEY = 'piano-learner-playlist-v1'

export type PlaylistPersist = {
  ids: string[]
  currentId: string | null
}

export type StoredMidiRow = {
  id: string
  name: string
  addedAt: number
  buffer: ArrayBuffer
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
  })
}

export function loadPlaylistPersist(): PlaylistPersist {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const o = JSON.parse(raw) as Partial<PlaylistPersist>
      return {
        ids: Array.isArray(o.ids) ? o.ids : [],
        currentId: typeof o.currentId === 'string' || o.currentId === null ? o.currentId : null,
      }
    }
  } catch {
    /* ignore */
  }
  return { ids: [], currentId: null }
}

export function savePlaylistPersist(p: PlaylistPersist): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

export async function putMidiFile(row: StoredMidiRow): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).put(row)
  })
}

export async function getMidiFile(
  id: string,
): Promise<{ name: string; buffer: ArrayBuffer } | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const v = req.result as StoredMidiRow | undefined
      if (!v?.buffer) {
        resolve(null)
        return
      }
      resolve({ name: v.name, buffer: v.buffer })
    }
  })
}

export async function deleteMidiFile(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).delete(id)
  })
}

export async function listStoredMidiMeta(): Promise<
  { id: string; name: string; addedAt: number }[]
> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const rows = (req.result as StoredMidiRow[]) ?? []
      resolve(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          addedAt: r.addedAt,
        })),
      )
    }
  })
}
