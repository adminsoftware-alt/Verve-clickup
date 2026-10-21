// Download the org chart as Excel or PDF, in whichever view is open.
//
// The tree in Excel is an indented sheet (who sits under whom, with the full reporting path);
// the table is a plain sheet to sort and filter. The PDF of the tree is drawn as a
// chart -- boxes and lines on one page sized to fit -- because a reporting tree printed as rows
// is exactly what the chart was meant to save people from reading.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { personName, type Person } from './peopleApi';

export interface OrgNode { person: Person; children: OrgNode[] }

interface Lookups { byId: Map<string, Person>; teamName: (id: string) => string | undefined }

const stamp = () => new Date().toISOString().slice(0, 10);

function tableRows(people: Person[], { byId, teamName }: Lookups): Record<string, string | number>[] {
  return [...people]
    .sort((a, b) => personName(a).localeCompare(personName(b)))
    .map((p) => {
      const boss = p.manager_id ? byId.get(p.manager_id) : undefined;
      return {
        Name: personName(p),
        Email: p.user.email,
        Designation: p.designation ?? '',
        Department: p.department ?? '',
        Level: p.level ?? '',
        'Reports to': boss ? personName(boss) : '',
        Teams: p.team_ids.map(teamName).filter(Boolean).join(', '),
        Status: p.pending ? 'Pending' : 'Active',
      };
    });
}

/** The tree as rows, depth first: the name indented by its depth, and the path above it spelled out. */
function treeRows(trees: OrgNode[]): Record<string, string | number>[] {
  const out: Record<string, string | number>[] = [];
  const walk = (n: OrgNode, depth: number, path: string[]) => {
    const name = personName(n.person);
    out.push({
      'Level in chart': depth + 1,
      // Em spaces survive in Excel where ordinary leading spaces are often trimmed.
      Name: `${'  '.repeat(depth)}${name}`,
      Designation: n.person.designation ?? '',
      Department: n.person.department ?? '',
      'Reports to': path.at(-1) ?? '',
      'Direct reports': n.children.length,
      'Reporting line': [...path, name].join(' › '),
    });
    n.children.forEach((c) => walk(c, depth + 1, [...path, name]));
  };
  trees.forEach((t) => walk(t, 0, []));
  return out;
}

function writeBook(rows: Record<string, string | number>[], widths: number[], sheet: string, filename: string): void {
  const book = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(book, ws, sheet);
  XLSX.writeFile(book, `${filename}.xlsx`);
}

export function orgChartTreeExcel(trees: OrgNode[], filename = `org-chart-tree-${stamp()}`): void {
  writeBook(treeRows(trees), [8, 40, 26, 20, 24, 10, 70], 'Org chart', filename);
}

export function orgChartTableExcel(people: Person[], lookups: Lookups, filename = `org-chart-table-${stamp()}`): void {
  writeBook(tableRows(people, lookups), [26, 32, 26, 20, 6, 24, 30, 9], 'Org chart', filename);
}

function header(doc: jsPDF, title: string, sub: string): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(17, 24, 39);
  doc.text(title, 40, 40);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(sub, 40, 56);
}

export function orgChartTablePdf(people: Person[], lookups: Lookups, title = 'Org chart', filename = `org-chart-table-${stamp()}`): void {
  const rows = tableRows(people, lookups);
  const columns = Object.keys(rows[0] ?? { Name: '' });
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const width = doc.internal.pageSize.getWidth();
  header(doc, title, `${rows.length} ${rows.length === 1 ? 'person' : 'people'} · ${new Date().toLocaleString()}`);
  autoTable(doc, {
    startY: 72,
    head: [columns],
    body: rows.map((r) => columns.map((c) => String(r[c] ?? ''))),
    styles: { fontSize: 8, cellPadding: 5, overflow: 'linebreak', textColor: [31, 41, 55] },
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 249, 248] },
    margin: { left: 40, right: 40, bottom: 40 },
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.setTextColor(156, 163, 175);
      doc.text(`Page ${doc.getNumberOfPages()}`, width - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
    },
  });
  doc.save(`${filename}.pdf`);
}

// Tree layout, in points. A manager with many people who manage nobody gets them in a block of
// columns under them rather than one long row, which is what makes a flat team printable.
const BOX_W = 150, BOX_H = 44, GAP_X = 16, GAP_Y = 36, BLOCK_ROWS = 6, MARGIN = 40, HEAD = 70;

interface Placed { node: OrgNode; x: number; y: number; kids: Placed[]; block: boolean }

/** Width a subtree needs. */
function span(n: OrgNode): number {
  if (!n.children.length) return BOX_W;
  if (isBlock(n)) return Math.max(BOX_W, Math.ceil(n.children.length / BLOCK_ROWS) * (BOX_W + GAP_X) - GAP_X + 12);
  return Math.max(BOX_W, n.children.reduce((s, c) => s + span(c), 0) + GAP_X * (n.children.length - 1));
}
const isBlock = (n: OrgNode) => n.children.length > 3 && n.children.every((c) => !c.children.length);

function place(n: OrgNode, left: number, y: number): Placed {
  const w = span(n);
  const me: Placed = { node: n, x: left + w / 2 - BOX_W / 2, y, kids: [], block: isBlock(n) };
  const below = y + BOX_H + GAP_Y;
  if (me.block) {
    const cols = Math.ceil(n.children.length / BLOCK_ROWS);
    const start = left + w / 2 - (cols * (BOX_W + GAP_X) - GAP_X) / 2 + 6;
    n.children.forEach((c, i) => {
      const col = Math.floor(i / BLOCK_ROWS), row = i % BLOCK_ROWS;
      me.kids.push({ node: c, x: start + col * (BOX_W + GAP_X), y: below + row * (BOX_H + 10), kids: [], block: false });
    });
  } else {
    let x = left;
    n.children.forEach((c) => { me.kids.push(place(c, x, below)); x += span(c) + GAP_X; });
  }
  return me;
}

function bottom(p: Placed): number {
  return Math.max(p.y + BOX_H, ...p.kids.map(bottom));
}

function fit(doc: jsPDF, text: string, max: number): string {
  if (doc.getTextWidth(text) <= max) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(`${t}…`) > max) t = t.slice(0, -1);
  return `${t}…`;
}

function draw(doc: jsPDF, p: Placed): void {
  const cx = p.x + BOX_W / 2;
  doc.setDrawColor(190, 197, 205);
  doc.setLineWidth(0.8);
  if (p.kids.length) {
    const midY = p.y + BOX_H + GAP_Y / 2;
    doc.line(cx, p.y + BOX_H, cx, midY);
    if (p.block) {
      // A bar over the block's columns, and a rail down the left of each column.
      const cols = [...new Set(p.kids.map((k) => k.x))];
      doc.line(Math.min(cx, cols[0] - 6), midY, Math.max(cx, cols.at(-1)! - 6), midY);
      cols.forEach((x) => {
        const inCol = p.kids.filter((k) => k.x === x);
        doc.line(x - 6, midY, x - 6, inCol.at(-1)!.y + BOX_H / 2);
        inCol.forEach((k) => doc.line(x - 6, k.y + BOX_H / 2, x, k.y + BOX_H / 2));
      });
    } else {
      const xs = p.kids.map((k) => k.x + BOX_W / 2);
      doc.line(Math.min(cx, xs[0]), midY, Math.max(cx, xs.at(-1)!), midY);
      xs.forEach((x, i) => doc.line(x, midY, x, p.kids[i].y));
    }
  }
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(209, 213, 219);
  doc.roundedRect(p.x, p.y, BOX_W, BOX_H, 6, 6, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(17, 24, 39);
  doc.text(fit(doc, personName(p.node.person), BOX_W - 16), cx, p.y + 18, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(107, 114, 128);
  const role = [p.node.person.designation, p.node.person.department].filter(Boolean).join(' · ') || '—';
  doc.text(fit(doc, role, BOX_W - 16), cx, p.y + 32, { align: 'center' });
  p.kids.forEach((k) => draw(doc, k));
}

export function orgChartTreePdf(trees: OrgNode[], count: number, title = 'Org chart', filename = `org-chart-tree-${stamp()}`): void {
  const placed: Placed[] = [];
  let x = MARGIN;
  trees.forEach((t) => { placed.push(place(t, x, MARGIN + HEAD)); x += span(t) + GAP_X * 2; });
  const width = Math.max(842, x - GAP_X * 2 + MARGIN);
  const height = Math.max(595, Math.max(MARGIN + HEAD, ...placed.map(bottom)) + MARGIN);
  // One page the size of the chart: a reader zooms into a PDF far more easily than they piece
  // together a chart cut across a stack of A4 sheets. jsPDF caps a page at 14400pt.
  const doc = new jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'pt', format: [Math.min(width, 14400), Math.min(height, 14400)] });
  header(doc, title, `${count} ${count === 1 ? 'person' : 'people'} · ${new Date().toLocaleString()}`);
  placed.forEach((p) => draw(doc, p));
  doc.save(`${filename}.pdf`);
}
