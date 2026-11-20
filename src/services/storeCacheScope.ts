// SHA-256 over an ASCII scope identifier; no secret or access credential is derived here.
// A portable implementation also supports existing HTTP LAN previews without WebCrypto.
export function storeScopeFingerprint(tenant: string, store: string) {
  const input = `zdm-store-cache-v1:${tenant}:${store}`;
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
  ];
  const initial = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const data = [...input].map((c) => c.charCodeAt(0));
  const length = data.length * 8;
  data.push(128);
  while (data.length % 64 !== 56) data.push(0);
  data.push(0, 0, 0, 0, (length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255);
  const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < data.length; offset += 64) {
    const words: number[] = [];
    for (let i = 0; i < 16; i++)
      words[i] =
        (data[offset + i * 4]! << 24) |
        (data[offset + i * 4 + 1]! << 16) |
        (data[offset + i * 4 + 2]! << 8) |
        data[offset + i * 4 + 3]!;
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15]!,
        y = words[i - 2]!;
      words[i] =
        (words[i - 16]! +
          (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) +
          words[i - 7]! +
          (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10))) |
        0;
    }
    let [a, b, c, d, e, f, g, h] = initial as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const first =
        (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[i]! + words[i]!) | 0;
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      [a, b, c, d, e, f, g, h] = [(first + second) | 0, a, b, c, (d + first) | 0, e, f, g];
    }
    [a, b, c, d, e, f, g, h].forEach((value, i) => {
      initial[i] = (initial[i]! + value) | 0;
    });
  }
  return initial.map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('');
}

const deletedScopes = new Set<string>();
export function markStoreCacheDeleted(tenant: string, store: string) {
  const fingerprint = storeScopeFingerprint(tenant, store);
  deletedScopes.add(fingerprint);
  localStorage.setItem(`zdm-store-cache-retired-v1:${fingerprint}`, '1');
}
export function storeCacheIsDeleted(tenant: string, store: string) {
  const fingerprint = storeScopeFingerprint(tenant, store);
  return deletedScopes.has(fingerprint) || localStorage.getItem(`zdm-store-cache-retired-v1:${fingerprint}`) === '1';
}
