require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'pharma_inventory',
  dateStrings: true,
  decimalNumbers: true,
  connectionLimit: 10,
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const h = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error(e.message);
    res.status(e.status || 400).json({ error: e.sqlMessage || e.message });
  });
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const q = async (sql, p = []) => (await pool.query(sql, p))[0];

// ---------- Dashboard ----------
app.get('/api/dashboard', h(async (req, res) => {
  const [s] = await q(`SELECT
    (SELECT COUNT(*) FROM Medicine) medicines,
    (SELECT COALESCE(SUM(quantity),0) FROM Batch WHERE expiry_date > CURDATE()) units,
    (SELECT COUNT(*) FROM Batch WHERE quantity>0 AND expiry_date > CURDATE() AND expiry_date <= CURDATE() + INTERVAL 90 DAY) expiring,
    (SELECT COUNT(*) FROM Batch WHERE quantity>0 AND expiry_date <= CURDATE()) expired,
    (SELECT COALESCE(SUM(total_amount),0) FROM Sale WHERE DATE(sale_date)=CURDATE()) today_sales,
    (SELECT COUNT(*) FROM PurchaseOrder WHERE status='Pending') pending_pos,
    (SELECT COUNT(*) FROM (SELECT m.medicine_id FROM Medicine m LEFT JOIN Batch b ON b.medicine_id=m.medicine_id AND b.expiry_date>CURDATE()
       GROUP BY m.medicine_id HAVING COALESCE(SUM(b.quantity),0) < 50) t) low_stock`);
  res.json(s);
}));

// ---------- Stock ----------
app.get('/api/stock', h(async (req, res) => {
  res.json(await q(`SELECT m.medicine_id, m.name, m.category, m.unit_price,
    COALESCE(SUM(CASE WHEN b.expiry_date > CURDATE() THEN b.quantity END),0) available
    FROM Medicine m LEFT JOIN Batch b ON b.medicine_id=m.medicine_id GROUP BY m.medicine_id ORDER BY m.name`));
}));

app.get('/api/batches', h(async (req, res) => {
  res.json(await q(`SELECT b.*, m.name medicine, DATEDIFF(b.expiry_date, CURDATE()) days_left
    FROM Batch b JOIN Medicine m USING (medicine_id) ORDER BY b.expiry_date`));
}));

app.post('/api/batches', h(async (req, res) => {
  const { medicine_id, batch_no, mfg_date, expiry_date, quantity } = req.body;
  const r = await q('INSERT INTO Batch (medicine_id,batch_no,mfg_date,expiry_date,quantity) VALUES (?,?,?,?,?)',
    [medicine_id, batch_no, mfg_date, expiry_date, quantity]);
  res.json({ batch_id: r.insertId });
}));

app.delete('/api/batches/:id', h(async (req, res) => {
  await q('DELETE FROM Batch WHERE batch_id=?', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- Sales (FEFO: first-expiry-first-out; triggers deduct stock) ----------
app.get('/api/sales', h(async (req, res) => {
  res.json(await q(`SELECT s.sale_id, s.sale_date, s.total_amount, c.name customer, e.name employee
    FROM Sale s JOIN Customer c USING (customer_id) JOIN Employee e USING (employee_id)
    ORDER BY s.sale_id DESC LIMIT 50`));
}));

app.get('/api/sales/:id', h(async (req, res) => {
  const [sale] = await q(`SELECT s.*, c.name customer, e.name employee FROM Sale s
    JOIN Customer c USING (customer_id) JOIN Employee e USING (employee_id) WHERE sale_id=?`, [req.params.id]);
  if (!sale) throw fail('Sale not found', 404);
  sale.items = await q(`SELECT si.quantity, si.unit_price, b.batch_no, b.expiry_date, m.name medicine
    FROM SaleItem si JOIN Batch b USING (batch_id) JOIN Medicine m USING (medicine_id) WHERE si.sale_id=?`, [req.params.id]);
  res.json(sale);
}));

app.post('/api/sales', h(async (req, res) => {
  const { customer_id, employee_id, items } = req.body;
  if (!customer_id || !employee_id || !items?.length) throw fail('Choose a customer, a staff member and at least one item');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [sale] = await conn.query('INSERT INTO Sale (customer_id, employee_id) VALUES (?,?)', [customer_id, employee_id]);
    for (const it of items) {
      const [[med]] = await conn.query('SELECT name, unit_price FROM Medicine WHERE medicine_id=?', [it.medicine_id]);
      if (!med) throw fail('Unknown medicine');
      let need = parseInt(it.quantity, 10);
      if (!(need > 0)) throw fail(`Invalid quantity for ${med.name}`);
      const [batches] = await conn.query(
        `SELECT batch_id, quantity FROM Batch WHERE medicine_id=? AND quantity>0 AND expiry_date>CURDATE()
         ORDER BY expiry_date FOR UPDATE`, [it.medicine_id]);
      for (const b of batches) {
        if (need === 0) break;
        const take = Math.min(need, b.quantity);
        await conn.query('INSERT INTO SaleItem (sale_id,batch_id,quantity,unit_price) VALUES (?,?,?,?)',
          [sale.insertId, b.batch_id, take, med.unit_price]);
        need -= take;
      }
      if (need > 0) throw fail(`Not enough unexpired stock for ${med.name} (short by ${need})`);
    }
    await conn.commit();
    res.json({ sale_id: sale.insertId });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));

// ---------- Purchase orders ----------
app.get('/api/purchase-orders', h(async (req, res) => {
  res.json(await q(`SELECT po.po_id, po.order_date, po.status, s.name supplier,
    COALESCE(SUM(i.quantity*i.unit_cost),0) total,
    GROUP_CONCAT(CONCAT(m.name,' x',i.quantity) SEPARATOR ', ') items
    FROM PurchaseOrder po JOIN Supplier s USING (supplier_id)
    LEFT JOIN PurchaseOrderItem i USING (po_id) LEFT JOIN Medicine m USING (medicine_id)
    GROUP BY po.po_id ORDER BY po.po_id DESC`));
}));

app.post('/api/purchase-orders', h(async (req, res) => {
  const { supplier_id, order_date, items } = req.body;
  if (!supplier_id || !items?.length) throw fail('Choose a supplier and add at least one item');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [po] = await conn.query('INSERT INTO PurchaseOrder (supplier_id, order_date) VALUES (?,?)',
      [supplier_id, order_date || new Date().toISOString().slice(0, 10)]);
    for (const i of items)
      await conn.query('INSERT INTO PurchaseOrderItem (po_id,medicine_id,quantity,unit_cost) VALUES (?,?,?,?)',
        [po.insertId, i.medicine_id, i.quantity, i.unit_cost]);
    await conn.commit();
    res.json({ po_id: po.insertId });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));

app.put('/api/purchase-orders/:id/status', h(async (req, res) => {
  await q('UPDATE PurchaseOrder SET status=? WHERE po_id=?', [req.body.status, req.params.id]);
  res.json({ ok: true });
}));

// ---------- Reports ----------
app.get('/api/reports/low-stock', h(async (req, res) => {
  res.json(await q(`SELECT m.name, m.category, COALESCE(SUM(b.quantity),0) available
    FROM Medicine m LEFT JOIN Batch b ON b.medicine_id=m.medicine_id AND b.expiry_date>CURDATE()
    GROUP BY m.medicine_id HAVING available < ? ORDER BY available`, [+req.query.threshold || 50]));
}));
app.get('/api/reports/expiry', h(async (req, res) => {
  res.json(await q(`SELECT m.name, b.batch_no, b.quantity, b.expiry_date, DATEDIFF(b.expiry_date, CURDATE()) days_left
    FROM Batch b JOIN Medicine m USING (medicine_id)
    WHERE b.quantity>0 AND b.expiry_date <= CURDATE() + INTERVAL ? DAY ORDER BY b.expiry_date`, [+req.query.days || 90]));
}));
app.get('/api/reports/supplier-purchases', h(async (req, res) => {
  res.json(await q(`SELECT s.name supplier, COUNT(DISTINCT po.po_id) orders, COALESCE(SUM(i.quantity*i.unit_cost),0) total
    FROM Supplier s LEFT JOIN PurchaseOrder po ON po.supplier_id=s.supplier_id AND po.status<>'Cancelled'
    LEFT JOIN PurchaseOrderItem i ON i.po_id=po.po_id GROUP BY s.supplier_id ORDER BY total DESC`));
}));
app.get('/api/reports/daily-sales', h(async (req, res) => {
  res.json(await q(`SELECT DATE(sale_date) day, COUNT(*) bills, SUM(total_amount) total
    FROM Sale GROUP BY DATE(sale_date) ORDER BY day DESC LIMIT 14`));
}));
app.get('/api/reports/top-medicines', h(async (req, res) => {
  res.json(await q(`SELECT m.name, SUM(si.quantity) units, SUM(si.quantity*si.unit_price) revenue
    FROM SaleItem si JOIN Batch b USING (batch_id) JOIN Medicine m USING (medicine_id)
    GROUP BY m.medicine_id ORDER BY units DESC LIMIT 10`));
}));

// ---------- Master tables: generic CRUD ----------
const masters = {
  medicines: { t: 'Medicine', pk: 'medicine_id', cols: ['name', 'category', 'manufacturer', 'unit_price'] },
  suppliers: { t: 'Supplier', pk: 'supplier_id', cols: ['name', 'contact_no', 'address', 'email'] },
  customers: { t: 'Customer', pk: 'customer_id', cols: ['name', 'contact_no', 'address'] },
  employees: { t: 'Employee', pk: 'employee_id', cols: ['name', 'role', 'contact_no'] },
};
const M = (req, res, next) => ((req.m = masters[req.params.m]) ? next() : res.status(404).json({ error: 'Not found' }));
const vals = (m, b) => m.cols.map((c) => (b[c] === '' ? null : b[c] ?? null));

app.get('/api/:m', M, h(async (req, res) => res.json(await q(`SELECT * FROM ${req.m.t} ORDER BY ${req.m.pk} DESC`))));
app.post('/api/:m', M, h(async (req, res) => {
  const m = req.m;
  const r = await q(`INSERT INTO ${m.t} (${m.cols}) VALUES (${m.cols.map(() => '?')})`, vals(m, req.body));
  res.json({ id: r.insertId });
}));
app.put('/api/:m/:id', M, h(async (req, res) => {
  const m = req.m;
  await q(`UPDATE ${m.t} SET ${m.cols.map((c) => c + '=?')} WHERE ${m.pk}=?`, [...vals(m, req.body), req.params.id]);
  res.json({ ok: true });
}));
app.delete('/api/:m/:id', M, h(async (req, res) => {
  try { await q(`DELETE FROM ${req.m.t} WHERE ${req.m.pk}=?`, [req.params.id]); res.json({ ok: true }); }
  catch (e) {
    if (e.errno === 1451) throw fail('This record is used by other records (batches, orders or sales) and cannot be deleted.');
    throw e;
  }
}));

const port = process.env.PORT || 3000;
pool.query('SELECT 1')
  .then(() => app.listen(port, () => console.log(`Pharma Inventory running at http://localhost:${port}`)))
  .catch((e) => { console.error('Cannot connect to MySQL:', e.message); process.exit(1); });
