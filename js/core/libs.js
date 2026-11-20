// CDN libraries, loaded on demand (and cached by the service worker for offline use).
export const LIBS = {
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  sqljs: 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js',
  sqljsBase: 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/',
  fzstd: 'https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js',
};

const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () => { loaded.delete(src); reject(new Error(`Couldn't load ${src.split('/').slice(-2).join('/')}. Are you online?`)); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
}

export async function getJSZip() { await loadScript(LIBS.jszip); return window.JSZip; }
export async function getZstd() { await loadScript(LIBS.fzstd); return window.fzstd; }

let sqlPromise = null;
export function getSQL() {
  if (!sqlPromise) {
    sqlPromise = loadScript(LIBS.sqljs)
      .then(() => window.initSqlJs({ locateFile: (f) => LIBS.sqljsBase + f }))
      .catch((e) => { sqlPromise = null; throw e; });
  }
  return sqlPromise;
}

export const isZstd = (u8) => u8.length >= 4 && u8[0] === 0x28 && u8[1] === 0xb5 && u8[2] === 0x2f && u8[3] === 0xfd;
