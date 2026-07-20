/* ============================================================
   Tiny self-contained QR Code generator (byte mode, EC level M,
   versions 1–10). No dependencies, no network. Public-domain
   clean-room implementation of the QR algorithm (ISO/IEC 18004).

   Usage:  var modules = QR.generate("some text");
           // modules is a 2D array of booleans (true = dark)
   Returns null if the text is too long for version 10.
   ============================================================ */
var QR = (function () {
  "use strict";

  /* ---- Galois field GF(256), primitive polynomial 0x11d ---- */
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  // Reed–Solomon: generator polynomial of given degree.
  function rsGenPoly(deg) {
    var poly = [1];
    for (var i = 0; i < deg; i++) {
      var next = new Array(poly.length + 1);
      for (var j = 0; j < next.length; j++) next[j] = 0;
      for (j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }
  function rsEncode(data, ecLen) {
    var gen = rsGenPoly(ecLen);
    var res = data.slice().concat(new Array(ecLen).fill(0));
    for (var i = 0; i < data.length; i++) {
      var coef = res[i];
      if (coef !== 0) {
        for (var j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], coef);
      }
    }
    return res.slice(data.length);
  }

  /* ---- EC level M block structure for versions 1–10 ----
     Each: [ecPerBlock, [numBlocks, dataPerBlock], (optional 2nd group)] */
  var ECM = {
    1: [10, [1, 16]], 2: [16, [1, 28]], 3: [26, [1, 44]], 4: [18, [2, 32]],
    5: [24, [2, 43]], 6: [16, [4, 27]], 7: [18, [4, 31]],
    8: [22, [2, 38], [2, 39]], 9: [22, [3, 36], [2, 37]], 10: [26, [4, 43], [1, 44]]
  };
  function dataCapacity(v) {
    var e = ECM[v]; var n = 0, i;
    for (i = 1; i < e.length; i++) n += e[i][0] * e[i][1];
    return n; // data codewords
  }
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  function bytesOf(str) {
    // UTF-8 encode
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else if (c < 0xd800 || c >= 0xe000) { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
      else { // surrogate pair
        i++; var c2 = str.charCodeAt(i);
        var cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      }
    }
    return out;
  }

  function chooseVersion(dataLen) {
    for (var v = 1; v <= 10; v++) {
      var countBits = v < 10 ? 8 : 16;
      var need = 4 + countBits + dataLen * 8; // mode + count + data bits
      if (dataCapacity(v) * 8 >= need) return v;
    }
    return 0;
  }

  /* ---- Bit buffer ---- */
  function BitBuf() { this.bits = []; }
  BitBuf.prototype.put = function (val, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((val >> i) & 1);
  };

  function buildCodewords(bytes, v) {
    var bb = new BitBuf();
    bb.put(4, 4); // byte mode
    bb.put(bytes.length, v < 10 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) bb.put(bytes[i], 8);
    var totalData = dataCapacity(v);
    var capacityBits = totalData * 8;
    // terminator
    var term = Math.min(4, capacityBits - bb.bits.length);
    bb.put(0, term);
    // pad to byte boundary
    while (bb.bits.length % 8 !== 0) bb.bits.push(0);
    // to bytes
    var codewords = [];
    for (i = 0; i < bb.bits.length; i += 8) {
      var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bb.bits[i + j];
      codewords.push(b);
    }
    // pad bytes
    var pads = [0xec, 0x11], p = 0;
    while (codewords.length < totalData) { codewords.push(pads[p % 2]); p++; }
    return codewords;
  }

  function interleave(codewords, v) {
    var e = ECM[v], ecLen = e[0];
    var groups = [], idx = 0;
    for (var g = 1; g < e.length; g++) {
      for (var b = 0; b < e[g][0]; b++) {
        var dc = codewords.slice(idx, idx + e[g][1]);
        idx += e[g][1];
        groups.push({ data: dc, ec: rsEncode(dc, ecLen) });
      }
    }
    var maxData = 0, i;
    groups.forEach(function (gr) { if (gr.data.length > maxData) maxData = gr.data.length; });
    var result = [];
    for (i = 0; i < maxData; i++) groups.forEach(function (gr) { if (i < gr.data.length) result.push(gr.data[i]); });
    for (i = 0; i < ecLen; i++) groups.forEach(function (gr) { result.push(gr.ec[i]); });
    return result;
  }

  /* ---- Matrix ---- */
  function makeMatrix(finalCodewords, v) {
    var size = 17 + v * 4;
    var m = [], reserved = [];
    for (var r = 0; r < size; r++) { m.push(new Array(size).fill(null)); reserved.push(new Array(size).fill(false)); }

    function placeFinder(row, col) {
      for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
        var rr = row + dr, cc = col + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        var inner = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        var dark = inner && ((dr === 0 || dr === 6 || dc === 0 || dc === 6) || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        m[rr][cc] = dark; reserved[rr][cc] = true;
      }
    }
    placeFinder(0, 0); placeFinder(0, size - 7); placeFinder(size - 7, 0);

    // timing patterns
    for (var i = 8; i < size - 8; i++) {
      if (m[6][i] === null) { m[6][i] = (i % 2 === 0); reserved[6][i] = true; }
      if (m[i][6] === null) { m[i][6] = (i % 2 === 0); reserved[i][6] = true; }
    }

    // alignment patterns — every coordinate pair except the three that coincide
    // with the finder patterns (they may overlap the timing lines, which is fine).
    var ac = ALIGN[v], lastI = ac.length - 1;
    for (var a = 0; a < ac.length; a++) for (var b = 0; b < ac.length; b++) {
      if ((a === 0 && b === 0) || (a === 0 && b === lastI) || (a === lastI && b === 0)) continue;
      var cr = ac[a], cc0 = ac[b];
      for (var dr2 = -2; dr2 <= 2; dr2++) for (var dc2 = -2; dc2 <= 2; dc2++) {
        var rr2 = cr + dr2, cc2 = cc0 + dc2;
        var dark2 = Math.max(Math.abs(dr2), Math.abs(dc2)) !== 1;
        m[rr2][cc2] = dark2; reserved[rr2][cc2] = true;
      }
    }

    // dark module
    m[size - 8][8] = true; reserved[size - 8][8] = true;

    // reserve format info areas
    for (i = 0; i < 9; i++) { if (!reserved[8][i]) reserved[8][i] = true; if (!reserved[i][8]) reserved[i][8] = true; }
    for (i = 0; i < 8; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }
    // reserve version info (v>=7)
    if (v >= 7) {
      for (i = 0; i < 6; i++) for (var k = 0; k < 3; k++) {
        reserved[i][size - 11 + k] = true; reserved[size - 11 + k][i] = true;
      }
    }

    // place data bits in the standard upward/downward zigzag, two columns at a
    // time from the right, skipping the vertical timing column (6).
    var allBits = [];
    finalCodewords.forEach(function (cw) { for (var z = 7; z >= 0; z--) allBits.push((cw >> z) & 1); });
    var bitIdx = 0;
    function placeBitAt(rr, cc) {
      if (reserved[rr][cc]) return;
      var bit = bitIdx < allBits.length ? allBits[bitIdx] : 0;
      bitIdx++;
      m[rr][cc] = bit === 1;
    }
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5; // step past the timing column
      var upward = ((col + 1) & 2) === 0;
      for (var t = 0; t < size; t++) {
        var rr3 = upward ? (size - 1 - t) : t;
        placeBitAt(rr3, col);
        placeBitAt(rr3, col - 1);
      }
    }

    return { m: m, reserved: reserved, size: size };
  }

  /* ---- Masking ---- */
  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r, c) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
    function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
    function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
  ];

  function applyMask(mat, maskFn) {
    var size = mat.size, out = [];
    for (var r = 0; r < size; r++) {
      out.push(mat.m[r].slice());
      for (var c = 0; c < size; c++) {
        if (!mat.reserved[r][c] && maskFn(r, c)) out[r][c] = !out[r][c];
      }
    }
    return out;
  }

  // Format info (EC level M = 0b00) with mask, 15-bit BCH.
  function formatBits(mask) {
    var data = (0 << 3) | mask; // EC M = 0b00
    var rem = data << 10;
    var g = 0x537;
    for (var i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= g << (i - 10);
    var bits = ((data << 10) | rem) ^ 0x5412;
    return bits & 0x7fff;
  }
  var VERSION_BCH = {}; // computed
  function versionBits(v) {
    if (VERSION_BCH[v] != null) return VERSION_BCH[v];
    var rem = v << 12, g = 0x1f25;
    for (var i = 17; i >= 12; i--) if ((rem >> i) & 1) rem ^= g << (i - 12);
    VERSION_BCH[v] = (v << 12) | rem;
    return VERSION_BCH[v];
  }

  function placeFormat(out, size, mask) {
    var bits = formatBits(mask);
    function gb(i) { return ((bits >> i) & 1) === 1; }
    // First copy: L-shape around the top-left finder (out[row][col]).
    for (var i = 0; i <= 5; i++) out[i][8] = gb(i);
    out[7][8] = gb(6);
    out[8][8] = gb(7);
    out[8][7] = gb(8);
    for (i = 9; i < 15; i++) out[8][14 - i] = gb(i);
    // Second copy: along row 8 (top-right) then column 8 (bottom-left).
    for (i = 0; i < 8; i++) out[8][size - 1 - i] = gb(i);
    for (i = 8; i < 15; i++) out[size - 15 + i][8] = gb(i);
    out[size - 8][8] = true; // always-dark module
  }
  function placeVersion(out, size, v) {
    if (v < 7) return;
    var bits = versionBits(v);
    for (var i = 0; i < 18; i++) {
      var bit = ((bits >> i) & 1) === 1;
      var r = Math.floor(i / 3), c = i % 3;
      out[r][size - 11 + c] = bit;
      out[size - 11 + c][r] = bit;
    }
  }

  function penalty(g) {
    var size = g.length, score = 0, r, c, i;
    // rule 1: runs of 5+
    for (r = 0; r < size; r++) {
      var run = 1;
      for (c = 1; c < size; c++) {
        if (g[r][c] === g[r][c - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
        else run = 1;
      }
    }
    for (c = 0; c < size; c++) {
      run = 1;
      for (r = 1; r < size; r++) {
        if (g[r][c] === g[r - 1][c]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
        else run = 1;
      }
    }
    // rule 2: 2x2 blocks
    for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {
      if (g[r][c] === g[r][c + 1] && g[r][c] === g[r + 1][c] && g[r][c] === g[r + 1][c + 1]) score += 3;
    }
    // rule 3: finder-like patterns
    var pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    for (r = 0; r < size; r++) for (c = 0; c < size - 10; c++) {
      var ok1 = true, ok2 = true;
      for (i = 0; i < 11; i++) { if (g[r][c + i] !== pat1[i]) ok1 = false; if (g[r][c + 10 - i] !== pat1[i]) ok2 = false; }
      if (ok1) score += 40; if (ok2) score += 40;
    }
    for (c = 0; c < size; c++) for (r = 0; r < size - 10; r++) {
      ok1 = true; ok2 = true;
      for (i = 0; i < 11; i++) { if (g[r + i][c] !== pat1[i]) ok1 = false; if (g[r + 10 - i][c] !== pat1[i]) ok2 = false; }
      if (ok1) score += 40; if (ok2) score += 40;
    }
    // rule 4: dark ratio
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (g[r][c]) dark++;
    var pct = (dark * 100) / (size * size);
    var k = Math.floor(Math.abs(pct - 50) / 5);
    score += k * 10;
    return score;
  }

  function generate(text) {
    var bytes = bytesOf(String(text));
    var v = chooseVersion(bytes.length);
    if (!v) return null;
    var codewords = buildCodewords(bytes, v);
    var finalCw = interleave(codewords, v);
    var mat = makeMatrix(finalCw, v);
    var best = null, bestScore = Infinity, bestMask = 0;
    for (var mask = 0; mask < 8; mask++) {
      var g = applyMask(mat, MASKS[mask]);
      placeFormat(g, mat.size, mask);
      placeVersion(g, mat.size, v);
      var sc = penalty(g);
      if (sc < bestScore) { bestScore = sc; best = g; bestMask = mask; }
    }
    return best;
  }

  return { generate: generate };
})();
