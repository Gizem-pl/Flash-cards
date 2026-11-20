// Minimal protobuf wire-format reader for Anki's schema-18 config blobs.
export class Proto {
  constructor(bytes) {
    this.fields = [];
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    let i = 0;
    const varint = () => {
      let result = 0n, shift = 0n;
      while (i < b.length) {
        const x = b[i++];
        result |= BigInt(x & 0x7f) << shift;
        if (!(x & 0x80)) return result;
        shift += 7n;
      }
      return null;
    };
    while (i < b.length) {
      const key = varint();
      if (key === null) break;
      const field = Number(key >> 3n), wire = Number(key & 7n);
      if (wire === 0) { const v = varint(); if (v === null) break; this.fields.push([field, 'v', v]); }
      else if (wire === 1) { if (i + 8 > b.length) break; this.fields.push([field, '64', b.slice(i, i + 8)]); i += 8; }
      else if (wire === 2) {
        const len = varint();
        if (len === null || i + Number(len) > b.length) break;
        this.fields.push([field, 'b', b.slice(i, i + Number(len))]);
        i += Number(len);
      } else if (wire === 5) { if (i + 4 > b.length) break; this.fields.push([field, '32', b.slice(i, i + 4)]); i += 4; }
      else break;
    }
  }
  all(n) { return this.fields.filter((f) => f[0] === n); }
  last(n) { const a = this.all(n); return a[a.length - 1]; }
  string(n) { const f = this.last(n); return f && f[1] === 'b' ? new TextDecoder().decode(f[2]) : null; }
  message(n) { const f = this.last(n); return f && f[1] === 'b' ? new Proto(f[2]) : null; }
  uint(n) { const f = this.last(n); return f && f[1] === 'v' ? Number(f[2]) : null; }
  int64(n) { const f = this.last(n); return f && f[1] === 'v' ? Number(BigInt.asIntN(64, f[2])) : null; }
  bool(n) { const v = this.uint(n); return v === null ? null : v !== 0; }
  float(n) { const f = this.last(n); return f && f[1] === '32' ? new DataView(f[2].buffer, f[2].byteOffset, 4).getFloat32(0, true) : null; }
  floats(n) {
    const out = [];
    for (const f of this.all(n)) {
      if (f[1] === '32') out.push(new DataView(f[2].buffer, f[2].byteOffset, 4).getFloat32(0, true));
      else if (f[1] === 'b') { const dv = new DataView(f[2].buffer, f[2].byteOffset, f[2].length); for (let i = 0; i + 4 <= f[2].length; i += 4) out.push(dv.getFloat32(i, true)); }
    }
    return out.map((x) => Math.round(x * 1e6) / 1e6);
  }
}

/** Minimal writer (used by tests). */
export class ProtoWriter {
  constructor() { this.bytes = []; }
  varint(v) { let x = BigInt(v); while (x >= 0x80n) { this.bytes.push(Number(x & 0x7fn) | 0x80); x >>= 7n; } this.bytes.push(Number(x)); }
  uint(f, v) { this.varint(f << 3); this.varint(v); return this; }
  bytesField(f, u8) { this.varint((f << 3) | 2); this.varint(u8.length); this.bytes.push(...u8); return this; }
  string(f, s) { return this.bytesField(f, new TextEncoder().encode(s)); }
  message(f, w) { return this.bytesField(f, w.data); }
  float(f, x) { this.varint((f << 3) | 5); const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); this.bytes.push(...b); return this; }
  packedFloats(f, xs) { const b = new Uint8Array(xs.length * 4); const dv = new DataView(b.buffer); xs.forEach((x, i) => dv.setFloat32(i * 4, x, true)); return this.bytesField(f, b); }
  get data() { return new Uint8Array(this.bytes); }
}
