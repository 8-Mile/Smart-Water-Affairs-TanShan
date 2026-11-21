// 替换的底图存放在当前浏览器中。仅持久化用户主动选择的图像文件。
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('flowops-screen-display', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('assets')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('图片存储正在被另一个页面占用'))
  })
}
export async function readImage(): Promise<Blob | undefined> {
  const db = await database()
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const req = db.transaction('assets').objectStore('assets').get('background')
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : undefined)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}
export async function storeImage(file: Blob | null): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite')
      const store = tx.objectStore('assets')
      if (file) store.put(file, 'background')
      else store.delete('background')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
