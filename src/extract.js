// ฟังก์ชันนี้ถูกส่งไปรันในหน้าเว็บผ่าน page.evaluate จึงต้องไม่อ้างอิงตัวแปรภายนอก
// อ่านเฉพาะโครงสร้างที่ต้องใช้ ไม่อ่านค่าในช่องกรอกข้อมูลและไม่อ่านคุกกี้
export function extractPage(profile) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const out = {
    url: location.href,
    title: document.title,
    hasLogout: false,
    hasPasswordInput: false,
    courseTable: null,
    registeredTable: null,
    text: '',
  };

  out.hasLogout = Array.from(document.querySelectorAll('a[href]')).some((a) =>
    (a.getAttribute('href') || '').includes(profile.logoutHrefContains),
  );
  out.hasPasswordInput = !!document.querySelector('input[type="password"]');
  out.text = norm(document.body ? document.body.innerText : '').slice(0, 4000);

  const findHeader = (table, labels) => {
    for (let r = 0; r < table.rows.length; r++) {
      const cells = Array.from(table.rows[r].cells).map((c) => norm(c.textContent));
      if (labels.every((l) => cells.includes(l))) return { index: r, cells };
    }
    return null;
  };

  const tables = Array.from(document.querySelectorAll('table'));

  const ct = profile.courseTable;
  for (const table of tables) {
    const header = findHeader(table, [ct.headerCode, ct.headerName, ct.headerAction]);
    if (!header) continue;
    const col = (label) => header.cells.indexOf(label);
    const iSeq = col(ct.headerSeq);
    const iCode = col(ct.headerCode);
    const iName = col(ct.headerName);
    const iCredit = col(ct.headerCredit);
    const iAction = col(ct.headerAction);
    const rows = [];
    for (let r = header.index + 1; r < table.rows.length; r++) {
      const tr = table.rows[r];
      const cells = Array.from(tr.cells);
      if (cells.length <= Math.max(iCode, iName, iAction)) continue;
      const code = norm(cells[iCode].textContent);
      if (!code) continue;
      tr.setAttribute('data-ea-row', code);
      const actionCell = cells[iAction];
      const controls = Array.from(
        actionCell.querySelectorAll('a[href], button, input:not([type="hidden"]), select, [onclick]'),
      ).map((el, i) => {
        const id = `${code}#${i}`;
        el.setAttribute('data-ea-id', id);
        const tag = el.tagName.toLowerCase();
        const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;
        const text =
          tag === 'input'
            ? norm(el.getAttribute('value') && ['button', 'submit'].includes(type) ? el.getAttribute('value') : '')
            : norm(el.textContent);
        return {
          id,
          tag,
          type,
          text: text || (tag === 'select' ? 'รายการเลือก' : tag === 'input' ? type : tag),
          disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
          options:
            tag === 'select'
              ? Array.from(el.options).map((o) => ({ value: o.value, text: norm(o.textContent) }))
              : undefined,
        };
      });
      rows.push({
        seq: iSeq >= 0 && cells[iSeq] ? norm(cells[iSeq].textContent) : '',
        code,
        name: norm(cells[iName].textContent),
        credit: iCredit >= 0 && cells[iCredit] ? norm(cells[iCredit].textContent) : '',
        actionText: norm(actionCell.textContent),
        controls,
      });
    }
    out.courseTable = { headers: header.cells, rows };
    break;
  }

  const rt = profile.registeredTable;
  for (const table of tables) {
    const header = findHeader(table, [rt.headerCode, rt.headerMarker]);
    if (!header) continue;
    const iCode = header.cells.indexOf(rt.headerCode);
    const iName = header.cells.indexOf(rt.headerName);
    const iSec = header.cells.indexOf(rt.headerMarker);
    const rows = [];
    let empty = false;
    for (let r = header.index + 1; r < table.rows.length; r++) {
      const cells = Array.from(table.rows[r].cells).map((c) => norm(c.textContent));
      if (cells.some((c) => c.includes(rt.emptyText))) {
        empty = true;
        continue;
      }
      if (cells.length <= iCode || !cells[iCode]) continue;
      rows.push({
        code: cells[iCode],
        name: iName >= 0 ? cells[iName] || '' : '',
        section: iSec >= 0 ? cells[iSec] || '' : '',
      });
    }
    out.registeredTable = { headers: header.cells, rows, empty: empty && rows.length === 0 };
    break;
  }

  return out;
}

// ไฮไลต์แถววิชาที่จะลงทะเบียน (รันในหน้าเว็บ)
export function highlightRows(codes) {
  document.querySelectorAll('[data-ea-row]').forEach((tr) => {
    tr.style.outline = '';
    tr.style.background = '';
  });
  let first = null;
  for (const code of codes) {
    const tr = document.querySelector(`[data-ea-row="${CSS.escape(code)}"]`);
    if (!tr) continue;
    tr.style.outline = '4px solid #ff9800';
    tr.style.background = '#fff3cd';
    if (!first) first = tr;
  }
  if (first) first.scrollIntoView({ block: 'center' });
  return !!first;
}

// สำเนาหน้าเว็บโดยลบค่าที่อยู่ในช่องกรอกข้อมูลออก (รันในหน้าเว็บ)
export function sanitizedHtml() {
  const doc = document.documentElement.cloneNode(true);
  doc.querySelectorAll('input').forEach((el) => el.removeAttribute('value'));
  doc.querySelectorAll('textarea').forEach((el) => {
    el.textContent = '';
  });
  doc.querySelectorAll('meta[name*="csrf" i], meta[name*="token" i]').forEach((el) => el.remove());
  return '<!doctype html>\n' + doc.outerHTML;
}
