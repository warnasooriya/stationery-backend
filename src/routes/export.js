const express = require('express');
const { z } = require('zod');
const { getPool } = require('../db');
const { listItemsWithStock } = require('../services/inventory');
const { makeWorkbook, workbookToBuffer } = require('../utils/xlsx');

const router = express.Router();

function sendWorkbook(res, { filename, workbook }) {
  const buffer = workbookToBuffer(workbook);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

router.get('/inventory', async (_req, res, next) => {
  try {
    const items = await listItemsWithStock(getPool());
    const rows = items.map((i) => ({
      'Item Identifier': i.itemIdentifier,
      'Item Description': i.itemDescription,
      'Current Stock': i.currentStock,
      'Minimum Safety Threshold': i.minSafetyThreshold,
      Status: i.stockStatus,
      'Total Purchased': i.totalPurchased,
      'Total Issued': i.totalIssued
    }));

    const workbook = makeWorkbook({ sheetName: 'Inventory', rows });
    sendWorkbook(res, { filename: 'master_inventory.xlsx', workbook });
  } catch (err) {
    next(err);
  }
});

router.get('/purchases', async (req, res, next) => {
  try {
    const db = getPool();
    const querySchema = z.object({
      itemId: z.string().optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    });
    const q = querySchema.parse(req.query);
    const itemId = q.itemId ? Number(q.itemId) : null;
    if (itemId !== null && !Number.isFinite(itemId)) return res.status(400).json({ error: 'Invalid itemId' });

    const where = [];
    const params = [];
    if (itemId !== null) {
      where.push('p.item_id = ?');
      params.push(itemId);
    }
    if (q.startDate) {
      where.push('p.purchased_at >= ?');
      params.push(q.startDate);
    }
    if (q.endDate) {
      where.push('p.purchased_at <= ?');
      params.push(q.endDate);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await db.query(
      `
      SELECT
        p.purchased_at,
        i.item_identifier,
        i.item_description,
        p.quantity_received,
        p.supplier_source,
        p.reference_invoice_number
      FROM purchases_log p
      INNER JOIN items i ON i.id = p.item_id
      ${whereSql}
      ORDER BY p.purchased_at DESC, p.id DESC
      `,
      params
    );

    const exportRows = rows.map((r) => ({
      Date: r.purchased_at,
      'Item Identifier': r.item_identifier,
      'Item Description': r.item_description,
      'Quantity Received': Number(r.quantity_received),
      'Supplier/Source': r.supplier_source,
      'Reference Invoice Number': r.reference_invoice_number
    }));

    const workbook = makeWorkbook({ sheetName: 'Purchases', rows: exportRows });
    sendWorkbook(res, { filename: 'purchases_log.xlsx', workbook });
  } catch (err) {
    next(err);
  }
});

router.get('/issuances', async (req, res, next) => {
  try {
    const db = getPool();

    const querySchema = z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      employeeId: z.string().optional(),
      itemId: z.string().optional()
    });

    const q = querySchema.parse(req.query);
    const startDate = q.startDate || null;
    const endDate = q.endDate || null;
    const employeeId = q.employeeId ? Number(q.employeeId) : null;
    const itemId = q.itemId ? Number(q.itemId) : null;
    if (employeeId !== null && !Number.isFinite(employeeId)) {
      return res.status(400).json({ error: 'Invalid employeeId' });
    }
    if (itemId !== null && !Number.isFinite(itemId)) {
      return res.status(400).json({ error: 'Invalid itemId' });
    }

    let employeeIdentifier = null;
    if (employeeId !== null) {
      const [employeeRows] = await db.query(
        `
        SELECT employee_identifier
        FROM employees
        WHERE id = ? AND is_active = 1
        `,
        [employeeId]
      );
      if (employeeRows.length === 0) return res.status(404).json({ error: 'Employee not found' });
      employeeIdentifier = employeeRows[0].employee_identifier;
    }

    const where = [];
    const params = [];
    if (startDate) {
      where.push('s.issued_at >= ?');
      params.push(startDate);
    }
    if (endDate) {
      where.push('s.issued_at <= ?');
      params.push(endDate);
    }
    if (employeeIdentifier) {
      where.push('s.issued_to = ?');
      params.push(employeeIdentifier);
    }
    if (itemId !== null) {
      where.push('s.item_id = ?');
      params.push(itemId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await db.query(
      `
      SELECT
        s.issued_at,
        i.item_identifier,
        s.quantity_issued,
        s.issued_to,
        e.employee_name,
        s.purpose_project
      FROM issuance_log s
      INNER JOIN items i ON i.id = s.item_id
      LEFT JOIN employees e ON e.employee_identifier = s.issued_to AND e.is_active = 1
      ${whereSql}
      ORDER BY s.issued_at DESC, s.id DESC
      `,
      params
    );

    const exportRows = rows.map((r) => ({
      Date: r.issued_at,
      'Item Identifier': r.item_identifier,
      'Quantity Issued': Number(r.quantity_issued),
      'Issued To (Employee ID)': r.issued_to,
      'Issued To (Employee Name)': r.employee_name || '',
      'Purpose/Project': r.purpose_project
    }));

    const workbook = makeWorkbook({ sheetName: 'Issuances', rows: exportRows });
    sendWorkbook(res, { filename: 'issuance_log.xlsx', workbook });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
