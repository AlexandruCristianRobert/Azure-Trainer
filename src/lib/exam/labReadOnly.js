// Exam-owned bridge: never create or upgrade the independent Lab database.
export function createLabReadOnlyRepository({ indexedDB = globalThis.indexedDB, dbName = 'azure-trainer-behavioral' } = {}) {
  let opening = null, database = null, closed = false
  const unavailable = () => new Error('Existing Lab storage is unavailable for read-only review.')
  function open() {
    if (closed) return Promise.reject(unavailable())
    if (opening) return opening
    const generation = new Promise((resolve, reject) => {
      let request, failed = false
      const rejectOpen = () => { failed = true; reject(unavailable()) }
      try { request = indexedDB.open(dbName, 1) } catch { rejectOpen(); return }
      request.onupgradeneeded = () => { request.transaction.abort(); rejectOpen() }
      request.onerror = rejectOpen
      request.onblocked = rejectOpen
      request.onsuccess = () => {
        const connected = request.result
        if (closed || failed || connected.version !== 1 || !['runs', 'results'].every(name => connected.objectStoreNames.contains(name))) {
          connected.close(); rejectOpen(); return
        }
        database = connected
        connected.onversionchange = () => { connected.close(); closed = true }
        resolve(connected)
      }
    })
    opening = generation
    void generation.catch(() => { if (opening === generation) opening = null })
    return generation
  }
  async function list(store) {
    const db = await open()
    if (closed) throw unavailable()
    return new Promise((resolve, reject) => {
      let tx, rows
      try {
        tx = db.transaction(store, 'readonly')
        const request = tx.objectStore(store).getAll()
        request.onsuccess = () => { rows = request.result }
      } catch { reject(unavailable()); return }
      tx.oncomplete = () => closed ? reject(unavailable()) : resolve(rows)
      tx.onabort = () => reject(unavailable())
      tx.onerror = () => reject(unavailable())
    })
  }
  return { listRuns: () => list('runs'), listResults: () => list('results'), close() { closed = true; database?.close() } }
}
