// Write a binary STL cube (default 20 mm) for smoke tests: node scripts/make-cube.mjs out.stl [size_mm]
import { writeFileSync } from 'node:fs';
const [out = 'test/fixtures/cube20.stl', size = '20'] = process.argv.slice(2);
const s = Number(size);
const v = [[0,0,0],[s,0,0],[s,s,0],[0,s,0],[0,0,s],[s,0,s],[s,s,s],[0,s,s]];
const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
const buf = Buffer.alloc(84 + faces.length * 50);
buf.write('preform cube fixture', 0, 'ascii');
buf.writeUInt32LE(faces.length, 80);
let o = 84;
for (const [a, b, c] of faces) {
  const [p, q, r] = [v[a], v[b], v[c]];
  const u = q.map((x, i) => x - p[i]), w = r.map((x, i) => x - p[i]);
  const n = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]];
  const len = Math.hypot(...n) || 1;
  for (const x of [...n.map((k) => k / len), ...p, ...q, ...r]) { buf.writeFloatLE(x, o); o += 4; }
  buf.writeUInt16LE(0, o); o += 2;
}
writeFileSync(out, buf);
console.log(`${out}: ${faces.length} triangles, ${s} mm`);
