const $ = (s, e = document) => e.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '₹' + Number(n || 0).toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);

async function api(url, method = 'GET', body) {
  const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}
let tt;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(tt); tt = setTimeout(() => (t.className = ''), 3500);
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 1); } };

function modal(title, body, onOk, okText = 'Save') {
  const f = $('#dlgForm');
  f.innerHTML = `<h3 style="margin-top:0">${title}</h3>${body}<div class="btns"><button type="button" class="ghost" id="x">Cancel</button><button type="submit">${okText}</button></div>`;
  $('#x').onclick = () => $('#dlg').close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { await onOk(new FormData(f)); $('#dlg').close(); } catch (er) { toast(er.message, 1); }
  };
  $('#dlg').showModal();
}
const field = (label, name, type = 'text', val = '', req = false, extra = '') =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(val)}" ${req ? 'required' : ''} ${extra}></label>`;
const select = (label, name, opts, val, req = true) =>
  `<label>${label}<select name="${name}" ${req ? 'required' : ''}><option value="">Select…</option>${opts
    .map((o) => `<option value="${o.v}" ${String(o.v) === String(val) ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select></label>`;
const table = (cols, rows, empty = 'Nothing here yet.') =>
  rows.length
    ? `<div class="wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.c || ''}">${c.h}</th>`).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${cols.map((c) => `<td class="${c.c || ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : `<div class="wrap empty">${empty}</div>`;
const expTag = (d, qty) =>
  qty === 0 ? '<span class="tag">Empty</span>'
    : d <= 0 ? '<span class="tag bad">Expired</span>'
    : d <= 90 ? `<span class="tag warn">${d} days left</span>` : `<span class="tag">${d} days left</span>`;

const view = $('#view'), actions = $('#actions');
const setHead = (t, html = '') => { $('#title').textContent = t; actions.innerHTML = html; };

// ---------- Master tables ----------
const M = {
  medicines: { title: 'Medicines', id: 'medicine_id', one: 'medicine', f: [['name', 'Name'], ['category', 'Category'], ['manufacturer', 'Manufacturer'], ['unit_price', 'Unit price (₹)', 'number']] },
  suppliers: { title: 'Suppliers', id: 'supplier_id', one: 'supplier', f: [['name', 'Name'], ['contact_no', 'Contact no.'], ['address', 'Address'], ['email', 'Email', 'email']] },
  customers: { title: 'Customers', id: 'customer_id', one: 'customer', f: [['name', 'Name'], ['contact_no', 'Contact no.'], ['address', 'Address']] },
  employees: { title: 'Staff', id: 'employee_id', one: 'staff member', f: [['name', 'Name'], ['role', 'Role'], ['contact_no', 'Contact no.']] },
};

async function crud(key) {
  const m = M[key];
  const rows = await api('/' + key);
  setHead(m.title, `<button id="add">Add ${m.one}</button>`);
  const form = (r = {}) => m.f.map(([k, l, t], i) => field(l, k, t || 'text', r[k], i === 0, t === 'number' ? 'step="0.01" min="0"' : '')).join('');
  const save = (id) => async (fd) => {
    await api(`/${key}${id ? '/' + id : ''}`, id ? 'PUT' : 'POST', Object.fromEntries(fd));
    toast(id ? 'Changes saved' : `${m.one[0].toUpperCase() + m.one.slice(1)} added`); crud(key);
  };
  $('#add').onclick = () => modal(`Add ${m.one}`, form(), save());
  view.innerHTML = table(
    [...m.f.map(([k, l, t]) => ({ h: l, c: t === 'number' ? 'r' : '', f: (r) => (t === 'number' ? money(r[k]) : esc(r[k] ?? '–')) })),
     { h: '', c: 'act', f: (r) => `<button class="ghost sm" data-e="${r[m.id]}">Edit</button><button class="danger sm" data-d="${r[m.id]}">Delete</button>` }],
    rows, `No ${m.title.toLowerCase()} yet. Add the first one.`);
  view.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => {
    const r = rows.find((x) => x[m.id] == b.dataset.e);
    modal(`Edit ${m.one}`, form(r), save(r[m.id]));
  }));
  view.querySelectorAll('[data-d]').forEach((b) => (b.onclick = guard(async () => {
    if (!confirm(`Delete this ${m.one}?`)) return;
    await api(`/${key}/${b.dataset.d}`, 'DELETE'); toast('Deleted'); crud(key);
  })));
}

// ---------- Dashboard ----------
async function dashboard() {
  setHead('Dashboard');
  const [s, low, exp] = await Promise.all([api('/dashboard'), api('/reports/low-stock'), api('/reports/expiry?days=90')]);
  const st = (n, l, c = '') => `<div class="stat ${c}"><b>${n}</b><span>${l}</span></div>`;
  view.innerHTML = `<div class="stats">
    ${st(money(s.today_sales), 'Sales today')}${st(s.units, 'Units in stock')}${st(s.medicines, 'Medicines listed')}
    ${st(s.low_stock, 'Low-stock medicines', s.low_stock ? 'warn' : '')}${st(s.expiring, 'Batches expiring in 90 days', s.expiring ? 'warn' : '')}
    ${st(s.expired, 'Expired batches with stock', s.expired ? 'bad' : '')}${st(s.pending_pos, 'Pending purchase orders')}</div>
    <div class="grid2"><div><h3>Running low (under 50 units)</h3>${lowTable(low)}</div><div><h3>Expiring soon</h3>${expTable(exp)}</div></div>`;
}
const lowTable = (r) => table([{ h: 'Medicine', f: (x) => esc(x.name) }, { h: 'Available', c: 'r', f: (x) => `<span class="tag ${x.available == 0 ? 'bad' : 'warn'}">${x.available}</span>` }], r, 'All medicines are well stocked.');
const expTable = (r) => table([{ h: 'Medicine', f: (x) => esc(x.name) }, { h: 'Batch', f: (x) => esc(x.batch_no) }, { h: 'Qty', c: 'r', f: (x) => x.quantity }, { h: 'Expiry', f: (x) => `${x.expiry_date} ${expTag(x.days_left, x.quantity)}` }], r, 'No batches near expiry.');

// ---------- Billing ----------
async function billing() {
  setHead('Billing');
  const [stock, customers, employees, sales] = await Promise.all([api('/stock'), api('/customers'), api('/employees'), api('/sales')]);
  let cart = [];
  view.innerHTML = `<div class="bill">
    <div class="card"><h3 style="margin-top:0">Add items</h3>
      <div class="row"><select id="med"><option value="">Select medicine…</option>${stock.map((s) => `<option value="${s.medicine_id}" ${s.available == 0 ? 'disabled' : ''}>${esc(s.name)} — ${s.available} in stock</option>`).join('')}</select>
      <input id="qty" type="number" min="1" value="1" aria-label="Quantity"><button id="addItem" type="button">Add</button></div>
      <div id="cart"></div></div>
    <div class="card"><h3 style="margin-top:0">Bill</h3>
      ${select('Customer', 'c', customers.map((c) => ({ v: c.customer_id, t: c.name })), customers.find((c) => c.name.startsWith('Walk-in'))?.customer_id)}
      ${select('Billed by', 'e', employees.map((e) => ({ v: e.employee_id, t: `${e.name} (${e.role || 'Staff'})` })), '')}
      <div class="total"><span>Total</span><span id="tot">₹0.00</span></div>
      <button id="done" style="width:100%">Complete sale</button></div></div>
    <h3>Recent sales</h3><div id="recent"></div>`;
  const drawCart = () => {
    $('#cart').innerHTML = cart.length
      ? table([{ h: 'Item', f: (l) => esc(l.name) }, { h: 'Qty', c: 'r', f: (l) => l.qty }, { h: 'Amount', c: 'r', f: (l) => money(l.qty * l.price) }, { h: '', c: 'act', f: (l) => `<button class="danger sm" data-r="${l.id}">Remove</button>` }], cart)
      : '<div class="empty">Cart is empty. Pick a medicine to start.</div>';
    $('#tot').textContent = money(cart.reduce((a, l) => a + l.qty * l.price, 0));
    $('#cart').querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { cart = cart.filter((l) => l.id != b.dataset.r); drawCart(); }));
  };
  drawCart();
  $('#addItem').onclick = () => {
    const s = stock.find((x) => x.medicine_id == $('#med').value), n = parseInt($('#qty').value, 10);
    if (!s) return toast('Choose a medicine first', 1);
    if (!(n > 0)) return toast('Enter a quantity of 1 or more', 1);
    const ex = cart.find((l) => l.id == s.medicine_id), have = (ex?.qty || 0) + n;
    if (have > s.available) return toast(`Only ${s.available} units of ${s.name} available`, 1);
    ex ? (ex.qty = have) : cart.push({ id: s.medicine_id, name: s.name, price: s.unit_price, qty: n });
    drawCart();
  };
  $('#recent').innerHTML = table(
    [{ h: 'Bill #', f: (s) => s.sale_id }, { h: 'Date', f: (s) => s.sale_date }, { h: 'Customer', f: (s) => esc(s.customer) }, { h: 'Billed by', f: (s) => esc(s.employee) },
     { h: 'Total', c: 'r', f: (s) => money(s.total_amount) }, { h: '', c: 'act', f: (s) => `<button class="ghost sm" data-v="${s.sale_id}">View</button>` }], sales, 'No sales recorded yet.');
  $('#recent').querySelectorAll('[data-v]').forEach((b) => (b.onclick = guard(() => receipt(b.dataset.v))));
  $('#done').onclick = guard(async () => {
    const r = await api('/sales', 'POST', {
      customer_id: $('[name=c]').value, employee_id: $('[name=e]').value,
      items: cart.map((l) => ({ medicine_id: l.id, quantity: l.qty })),
    });
    toast(`Bill #${r.sale_id} saved. Stock updated.`);
    await billing(); receipt(r.sale_id);
  });
}
async function receipt(id) {
  const s = await api('/sales/' + id);
  modal(`Bill #${s.sale_id}`, `<p style="color:var(--mute);margin:0">${esc(s.sale_date)} · ${esc(s.customer)} · by ${esc(s.employee)}</p>` +
    table([{ h: 'Item', f: (i) => `${esc(i.medicine)}<br><small style="color:var(--mute)">Batch ${esc(i.batch_no)}</small>` }, { h: 'Qty', c: 'r', f: (i) => i.quantity },
      { h: 'Amount', c: 'r', f: (i) => money(i.quantity * i.unit_price) }], s.items) +
    `<div class="total"><span>Total</span><span>${money(s.total_amount)}</span></div>`, () => {}, 'Close');
}

// ---------- Stock (batches) ----------
async function stockView() {
  setHead('Stock & batches', '<button id="add">Receive batch</button>');
  const [batches, meds] = await Promise.all([api('/batches'), api('/medicines')]);
  $('#add').onclick = () => modal('Receive batch',
    select('Medicine', 'medicine_id', meds.map((m) => ({ v: m.medicine_id, t: m.name })), '') + field('Batch number', 'batch_no', 'text', '', true) +
    field('Manufacturing date', 'mfg_date', 'date', '', true) + field('Expiry date', 'expiry_date', 'date', '', true) + field('Quantity received', 'quantity', 'number', '', true, 'min="0"'),
    async (fd) => { await api('/batches', 'POST', Object.fromEntries(fd)); toast('Batch added to stock'); stockView(); });
  view.innerHTML = table(
    [{ h: 'Medicine', f: (b) => esc(b.medicine) }, { h: 'Batch', f: (b) => esc(b.batch_no) }, { h: 'Mfg', f: (b) => b.mfg_date }, { h: 'Expiry', f: (b) => b.expiry_date },
     { h: 'Qty', c: 'r', f: (b) => b.quantity }, { h: 'Status', f: (b) => expTag(b.days_left, b.quantity) },
     { h: '', c: 'act', f: (b) => `<button class="danger sm" data-d="${b.batch_id}">Remove</button>` }], batches, 'No batches yet. Receive the first batch.');
  view.querySelectorAll('[data-d]').forEach((b) => (b.onclick = guard(async () => {
    if (!confirm('Remove this batch? Batches already used in a sale cannot be removed.')) return;
    await api('/batches/' + b.dataset.d, 'DELETE'); toast('Batch removed'); stockView();
  })));
}

// ---------- Purchase orders ----------
async function orders() {
  setHead('Purchase orders', '<button id="add">New purchase order</button>');
  const [pos, sups, meds] = await Promise.all([api('/purchase-orders'), api('/suppliers'), api('/medicines')]);
  const medOpts = `<option value="">Medicine…</option>${meds.map((m) => `<option value="${m.medicine_id}">${esc(m.name)}</option>`).join('')}`;
  const rowHtml = () => `<div class="row"><select name="m" required>${medOpts}</select><input name="q" type="number" min="1" placeholder="Qty" required><input name="c" type="number" min="0" step="0.01" placeholder="Cost" required></div>`;
  $('#add').onclick = () => {
    modal('New purchase order',
      select('Supplier', 'supplier_id', sups.map((s) => ({ v: s.supplier_id, t: s.name })), '') + field('Order date', 'order_date', 'date', today(), true) +
      `<label>Items</label><div id="rows">${rowHtml()}</div><button type="button" class="ghost sm" id="more">Add another item</button>`,
      async (fd) => {
        const items = fd.getAll('m').map((m, i) => ({ medicine_id: m, quantity: fd.getAll('q')[i], unit_cost: fd.getAll('c')[i] }));
        await api('/purchase-orders', 'POST', { supplier_id: fd.get('supplier_id'), order_date: fd.get('order_date'), items });
        toast('Purchase order created'); orders();
      }, 'Create order');
    $('#more').onclick = () => $('#rows').insertAdjacentHTML('beforeend', rowHtml());
  };
  const cls = { Pending: 'warn', Received: '', Cancelled: 'bad' };
  view.innerHTML = table(
    [{ h: 'PO #', f: (p) => p.po_id }, { h: 'Date', f: (p) => p.order_date }, { h: 'Supplier', f: (p) => esc(p.supplier) }, { h: 'Items', c: 'wrapt', f: (p) => esc(p.items || '–') },
     { h: 'Total', c: 'r', f: (p) => money(p.total) }, { h: 'Status', f: (p) => `<span class="tag ${cls[p.status]}">${p.status}</span>` },
     { h: '', c: 'act', f: (p) => (p.status === 'Pending' ? `<button class="sm" data-s="Received" data-id="${p.po_id}">Mark received</button><button class="danger sm" data-s="Cancelled" data-id="${p.po_id}">Cancel</button>` : '') }],
    pos, 'No purchase orders yet.');
  view.querySelectorAll('[data-s]').forEach((b) => (b.onclick = guard(async () => {
    await api(`/purchase-orders/${b.dataset.id}/status`, 'PUT', { status: b.dataset.s });
    toast(b.dataset.s === 'Received' ? 'Marked received. Add its batches under Stock.' : 'Order cancelled'); orders();
  })));
}

// ---------- Reports ----------
async function reports() {
  setHead('Reports');
  view.innerHTML = `<h3 style="margin-top:0">Low stock</h3><div class="row" style="max-width:260px"><span>Below</span><input id="th" type="number" value="50" min="1"><span>units</span></div><div id="r1"></div>
    <h3>Expiry list</h3><div class="row" style="max-width:260px"><span>Within</span><input id="dy" type="number" value="90" min="1"><span>days</span></div><div id="r2"></div>
    <h3>Supplier-wise purchases</h3><div id="r3"></div><h3>Daily sales (last 14 days)</h3><div id="r4"></div><h3>Fast-moving medicines</h3><div id="r5"></div>`;
  const low = guard(async () => ($('#r1').innerHTML = lowTable(await api('/reports/low-stock?threshold=' + $('#th').value))));
  const exp = guard(async () => ($('#r2').innerHTML = expTable(await api('/reports/expiry?days=' + $('#dy').value))));
  $('#th').onchange = low; $('#dy').onchange = exp; low(); exp();
  $('#r3').innerHTML = table([{ h: 'Supplier', f: (r) => esc(r.supplier) }, { h: 'Orders', c: 'r', f: (r) => r.orders }, { h: 'Total spent', c: 'r', f: (r) => money(r.total) }], await api('/reports/supplier-purchases'));
  $('#r4').innerHTML = table([{ h: 'Date', f: (r) => r.day }, { h: 'Bills', c: 'r', f: (r) => r.bills }, { h: 'Sales', c: 'r', f: (r) => money(r.total) }], await api('/reports/daily-sales'), 'No sales yet.');
  $('#r5').innerHTML = table([{ h: 'Medicine', f: (r) => esc(r.name) }, { h: 'Units sold', c: 'r', f: (r) => r.units }, { h: 'Revenue', c: 'r', f: (r) => money(r.revenue) }], await api('/reports/top-medicines'), 'No sales yet.');
}

// ---------- Router ----------
const routes = {
  dashboard: ['Dashboard', dashboard], billing: ['Billing', billing], stock: ['Stock & batches', stockView], orders: ['Purchase orders', orders],
  medicines: ['Medicines', () => crud('medicines')], suppliers: ['Suppliers', () => crud('suppliers')],
  customers: ['Customers', () => crud('customers')], employees: ['Staff', () => crud('employees')], reports: ['Reports', reports],
};
$('#nav nav').innerHTML = Object.entries(routes).map(([k, [l]]) => `<a href="#${k}" data-k="${k}">${l}</a>`).join('');
const go = guard(async () => {
  const k = routes[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.k === k));
  view.innerHTML = '';
  await routes[k][1]();
});
addEventListener('hashchange', go);
go();
