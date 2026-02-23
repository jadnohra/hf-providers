// Sortable table columns. Call wireSort(table) after inserting a <table class="mt"> into the DOM.
// Adds click handlers to <th> elements. Sorts by text content, with special handling for
// numbers, prices ($X.XX), and tok/s values.

export function wireSort(table) {
  if (!table) return;
  const headers = table.querySelectorAll('thead th');

  headers.forEach((th, colIdx) => {
    // Skip empty headers and group-spanning headers
    if (!th.textContent.trim()) return;
    if (th.colSpan > 1) return;

    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';
    th.title = 'Click to sort';

    let asc = true;

    th.addEventListener('click', () => {
      const tbody = table.querySelector('tbody');
      if (!tbody) return;

      // Collect sortable rows (skip group-row separators)
      const rows = Array.from(tbody.querySelectorAll('tr:not(.group-row)'));
      if (rows.length < 2) return;

      rows.sort((a, b) => {
        const aVal = cellValue(a.children[colIdx]);
        const bVal = cellValue(b.children[colIdx]);

        // Both numeric
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return asc ? aVal - bVal : bVal - aVal;
        }
        // One numeric, push non-numeric to end
        if (typeof aVal === 'number') return -1;
        if (typeof bVal === 'number') return 1;

        // String compare
        const cmp = String(aVal).localeCompare(String(bVal));
        return asc ? cmp : -cmp;
      });

      // Remove group rows, re-append sorted rows
      tbody.querySelectorAll('.group-row').forEach(r => r.remove());
      for (const row of rows) {
        tbody.appendChild(row);
      }

      // Update header indicators
      headers.forEach(h => {
        h.textContent = h.textContent.replace(/ [▲▼]$/, '');
      });
      th.textContent += asc ? ' ▲' : ' ▼';

      asc = !asc;
    });
  });
}

function cellValue(td) {
  if (!td) return '';
  const text = td.textContent.trim();
  if (!text || text === '—') return '';

  // Price: $1.23
  const priceMatch = text.match(/^\$([0-9.]+)/);
  if (priceMatch) return parseFloat(priceMatch[1]);

  // tok/s: 128 tok/s or 2.1k tok/s
  const tokMatch = text.match(/^([0-9.]+)k?\s*tok\/s/i);
  if (tokMatch) {
    let v = parseFloat(tokMatch[1]);
    if (text.includes('k ') || text.includes('k\u00a0')) v *= 1000;
    return v;
  }

  // GB: 24 GB or 24GB
  const gbMatch = text.match(/^([0-9.]+)\s*GB/);
  if (gbMatch) return parseFloat(gbMatch[1]);

  // Number with suffix: 4.1M, 1.2k, 70.6B, 700
  const suffMatch = text.match(/^([0-9.]+)\s*([kmb])?$/i);
  if (suffMatch) {
    let v = parseFloat(suffMatch[1]);
    const s = (suffMatch[2] || '').toLowerCase();
    if (s === 'k') v *= 1e3;
    if (s === 'm') v *= 1e6;
    if (s === 'b') v *= 1e9;
    if (!isNaN(v)) return v;
  }

  // Plain number with commas
  const num = parseFloat(text.replace(/,/g, ''));
  if (!isNaN(num) && /^[0-9.,]+$/.test(text.replace(/\s/g, ''))) return num;

  // Status ordering
  const statusOrder = { hot: 1, warm: 2, cold: 3, unavailable: 4 };
  const lower = text.toLowerCase();
  if (statusOrder[lower]) return statusOrder[lower];

  return text.toLowerCase();
}
