/**
 * Generador de códigos QR (sin librerías): modo byte, corrección de errores nivel M (resiste ~15 % de
 * daño en la etiqueta), versiones 1 a 10 (hasta ~210 caracteres; una dirección de la app usa ~60).
 * Sigue la norma ISO/IEC 18004: datos + Reed-Solomon, patrones fijos, la mejor de las 8 máscaras.
 */

const ECC_M: Record<number, [number, number]> = {
  // versión: [códigos de corrección por bloque, bloques]
  1: [10, 1], 2: [16, 1], 3: [26, 1], 4: [18, 2], 5: [24, 2],
  6: [16, 4], 7: [18, 4], 8: [22, 4], 9: [22, 5], 10: [26, 5],
};

function modulosDeDatos(v: number): number {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (v >= 7) r -= 36;
  }
  return r;
}
const codigosDeDatos = (v: number) => Math.floor(modulosDeDatos(v) / 8) - ECC_M[v][0] * ECC_M[v][1];

function posicionesAlineacion(v: number): number[] {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const paso = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = v * 4 + 17 - 7; r.length < n; pos -= paso) r.splice(1, 0, pos);
  return r;
}

// Reed-Solomon sobre GF(256), polinomio 0x11D.
function mult(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function divisor(grado: number): number[] {
  const r = new Array<number>(grado).fill(0);
  r[grado - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grado; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = mult(r[j], raiz);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    raiz = mult(raiz, 0x02);
  }
  return r;
}
function resto(datos: number[], div: number[]): number[] {
  const r = new Array<number>(div.length).fill(0);
  for (const b of datos) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    div.forEach((c, i) => (r[i] ^= mult(c, f)));
  }
  return r;
}

/** Matriz del QR (true = módulo negro). Lanza un error si el texto es demasiado largo. */
export function qrMatriz(texto: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(texto));
  let v = 1;
  for (; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= codigosDeDatos(v) * 8) break;
  if (v > 10) throw new Error("Texto demasiado largo para el código QR");

  // 1) Bits de datos: modo byte, longitud, bytes, terminador y relleno.
  const bits: number[] = [];
  const poner = (val: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  poner(0b0100, 4);
  poner(bytes.length, v < 10 ? 8 : 16);
  bytes.forEach((b) => poner(b, 8));
  const capacidad = codigosDeDatos(v) * 8;
  poner(0, Math.min(4, capacidad - bits.length));
  poner(0, (8 - (bits.length % 8)) % 8);
  for (let p = 0xec; bits.length < capacidad; p ^= 0xec ^ 0x11) poner(p, 8);
  const datos: number[] = [];
  for (let i = 0; i < bits.length; i += 8) datos.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // 2) Bloques con su corrección de errores, intercalados.
  const [eccLen, nBloques] = ECC_M[v];
  const crudos = Math.floor(modulosDeDatos(v) / 8);
  const cortos = nBloques - (crudos % nBloques);
  const largoCorto = Math.floor(crudos / nBloques);
  const div = divisor(eccLen);
  const bloques: number[][] = [];
  for (let i = 0, k = 0; i < nBloques; i++) {
    const n = largoCorto - eccLen + (i < cortos ? 0 : 1);
    const d = datos.slice(k, k + n);
    k += n;
    const ecc = resto(d, div);
    if (i < cortos) d.push(0); // hueco para alinear con los bloques largos
    bloques.push(d.concat(ecc));
  }
  const final: number[] = [];
  for (let i = 0; i < bloques[0].length; i++) {
    bloques.forEach((b, j) => {
      if (i !== largoCorto - eccLen || j >= cortos) final.push(b[i]);
    });
  }

  // 3) Patrones fijos.
  const tam = v * 4 + 17;
  const m: boolean[][] = Array.from({ length: tam }, () => new Array<boolean>(tam).fill(false));
  const fijo: boolean[][] = Array.from({ length: tam }, () => new Array<boolean>(tam).fill(false));
  const set = (x: number, y: number, negro: boolean) => {
    m[y][x] = negro;
    fijo[y][x] = true;
  };
  for (let i = 0; i < tam; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const buscador = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < tam && y >= 0 && y < tam) set(x, y, d !== 2 && d !== 4);
      }
  };
  buscador(3, 3);
  buscador(tam - 4, 3);
  buscador(3, tam - 4);
  const al = posicionesAlineacion(v);
  for (let i = 0; i < al.length; i++)
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  const formato = (mask: number) => {
    const d = (0 << 3) | mask; // nivel M = 00
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    const bit = (i: number) => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(tam - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, tam - 15 + i, bit(i));
    set(8, tam - 8, true);
  };
  formato(0); // reserva las zonas de formato
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) {
      const negro = ((b >>> i) & 1) !== 0;
      const a = tam - 11 + (i % 3), c = Math.floor(i / 3);
      set(a, c, negro);
      set(c, a, negro);
    }
  }

  // 4) Datos en zigzag.
  let i = 0;
  for (let der = tam - 1; der >= 1; der -= 2) {
    if (der === 6) der = 5;
    for (let vert = 0; vert < tam; vert++)
      for (let j = 0; j < 2; j++) {
        const x = der - j;
        const arriba = ((der + 1) & 2) === 0;
        const y = arriba ? tam - 1 - vert : vert;
        if (!fijo[y][x] && i < final.length * 8) {
          m[y][x] = ((final[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
  }

  // 5) La máscara con menor penalización.
  const aplicar = (mask: number) => {
    for (let y = 0; y < tam; y++)
      for (let x = 0; x < tam; x++) {
        if (fijo[y][x]) continue;
        const c = [(x + y) % 2, y % 2, x % 3, (x + y) % 3, (Math.floor(x / 3) + Math.floor(y / 2)) % 2,
          ((x * y) % 2) + ((x * y) % 3), (((x * y) % 2) + ((x * y) % 3)) % 2, (((x + y) % 2) + ((x * y) % 3)) % 2][mask];
        if (c === 0) m[y][x] = !m[y][x];
      }
  };
  let mejor = 0, menor = Infinity;
  for (let k = 0; k < 8; k++) {
    aplicar(k);
    formato(k);
    const p = penalizacion(m);
    if (p < menor) {
      menor = p;
      mejor = k;
    }
    aplicar(k); // deshace (XOR)
  }
  aplicar(mejor);
  formato(mejor);
  return m;
}

function penalizacion(m: boolean[][]): number {
  const n = m.length;
  let p = 0;
  const linea = (get: (i: number) => boolean) => {
    let corrida = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) corrida++;
      else {
        if (corrida >= 5) p += corrida - 2;
        corrida = 1;
      }
    }
    for (let i = 0; i + 10 < n + 4; i++) {
      // patrón 1:1:3:1:1 con 4 claros a un lado
      const at = (k: number) => (k >= 0 && k < n ? get(k) : false);
      const pat = [true, false, true, true, true, false, true];
      const ok = pat.every((b, k) => at(i + k) === b);
      if (ok) {
        const antes = [1, 2, 3, 4].every((k) => !at(i - k));
        const despues = [1, 2, 3, 4].every((k) => !at(i + 6 + k));
        if (antes || despues) p += 40;
      }
    }
  };
  for (let y = 0; y < n; y++) linea((x) => m[y][x]);
  for (let x = 0; x < n; x++) linea((y) => m[y][x]);
  let negros = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (m[y][x]) negros++;
      if (y + 1 < n && x + 1 < n && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    }
  const total = n * n;
  p += (Math.ceil(Math.abs(negros * 20 - total * 10) / total) - 1) * 10;
  return p;
}

/** El QR como SVG (con margen blanco de 4 módulos), listo para pantalla o impresión. */
export function qrSvg(texto: string, tamPx = 160): string {
  const m = qrMatriz(texto);
  const n = m.length + 8;
  let d = "";
  m.forEach((fila, y) => fila.forEach((negro, x) => {
    if (negro) d += `M${x + 4} ${y + 4}h1v1h-1z`;
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamPx}" height="${tamPx}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
