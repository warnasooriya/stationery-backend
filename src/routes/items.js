const express = require('express');
const { z } = require('zod');
const { getPool } = require('../db');
const { listItemsWithStock, getItemCore, getItemHistory } = require('../services/inventory');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const items = await listItemsWithStock(getPool());
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid item id' });

    const item = await getItemCore(getPool(), id);
    if (!item || Number(item.is_active) !== 1) return res.status(404).json({ error: 'Item not found' });

    res.json({
      item: {
        id: item.id,
        itemIdentifier: item.item_identifier,
        itemDescription: item.item_description,
        minSafetyThreshold: Number(item.min_safety_threshold)
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/history', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid item id' });

    const item = await getItemCore(getPool(), id);
    if (!item || Number(item.is_active) !== 1) return res.status(404).json({ error: 'Item not found' });

    const history = await getItemHistory(getPool(), id);
    res.json({
      item: {
        id: item.id,
        itemIdentifier: item.item_identifier,
        itemDescription: item.item_description,
        minSafetyThreshold: Number(item.min_safety_threshold)
      },
      history
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/bin-card', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid item id' });

    const querySchema = z.object({
      page: z.string().optional(),
      pageSize: z.string().optional()
    });
    const q = querySchema.parse(req.query);

    const page = q.page ? Number(q.page) : 1;
    const pageSize = q.pageSize ? Number(q.pageSize) : 25;
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safePageSize =
      Number.isFinite(pageSize) && pageSize > 0 ? Math.min(200, Math.floor(pageSize)) : 25;
    const offset = (safePage - 1) * safePageSize;

    const db = getPool();
    const item = await getItemCore(db, id);
    if (!item || Number(item.is_active) !== 1) return res.status(404).json({ error: 'Item not found' });

    const [stockRows] = await db.query(
      `
      SELECT
        (SELECT COALESCE(SUM(quantity_received), 0) FROM purchases_log WHERE item_id = ?) AS total_received,
        (SELECT COALESCE(SUM(quantity_issued), 0) FROM issuance_log WHERE item_id = ?) AS total_issued
      `,
      [id, id]
    );
    const totalPurchased = Number(stockRows[0]?.total_received || 0);
    const totalIssued = Number(stockRows[0]?.total_issued || 0);
    const currentStock = totalPurchased - totalIssued;
    const minSafetyThreshold = Number(item.min_safety_threshold);

    const [countRows] = await db.query(
      `
      SELECT COUNT(*) AS c FROM (
        SELECT p.id
        FROM purchases_log p
        WHERE p.item_id = ?
        UNION ALL
        SELECT s.id
        FROM issuance_log s
        WHERE s.item_id = ?
      ) x
      `,
      [id, id]
    );
    const total = Number(countRows[0]?.c || 0);

    const [rows] = await db.query(
      `
      WITH events AS (
        SELECT
          'PURCHASE' AS type,
          p.id AS event_id,
          p.purchased_at AS occurred_at,
          p.quantity_received AS qty_in,
          0 AS qty_out,
          p.supplier_source AS supplier_source,
          p.reference_invoice_number AS reference_invoice_number,
          NULL AS employee_identifier,
          NULL AS employee_name,
          NULL AS purpose_project,
          p.quantity_received AS delta,
          0 AS type_sort
        FROM purchases_log p
        WHERE p.item_id = ?
        UNION ALL
        SELECT
          'ISSUE' AS type,
          s.id AS event_id,
          s.issued_at AS occurred_at,
          0 AS qty_in,
          s.quantity_issued AS qty_out,
          NULL AS supplier_source,
          NULL AS reference_invoice_number,
          s.issued_to AS employee_identifier,
          e.employee_name AS employee_name,
          s.purpose_project AS purpose_project,
          -s.quantity_issued AS delta,
          1 AS type_sort
        FROM issuance_log s
        LEFT JOIN employees e ON e.employee_identifier = s.issued_to AND e.is_active = 1
        WHERE s.item_id = ?
      )
      SELECT *
      FROM (
        SELECT
          type,
          event_id,
          occurred_at,
          qty_in,
          qty_out,
          supplier_source,
          reference_invoice_number,
          employee_identifier,
          employee_name,
          purpose_project,
          type_sort,
          SUM(delta) OVER (ORDER BY occurred_at ASC, type_sort ASC, event_id ASC) AS running_stock
        FROM events
      ) t
      ORDER BY occurred_at DESC, type_sort DESC, event_id DESC
      LIMIT ? OFFSET ?
      `,
      [id, id, safePageSize, offset]
    );

    res.json({
      item: {
        id: item.id,
        itemIdentifier: item.item_identifier,
        itemDescription: item.item_description,
        minSafetyThreshold,
        totalPurchased,
        totalIssued,
        currentStock,
        stockStatus: currentStock <= minSafetyThreshold ? 'LOW STOCK' : 'GOOD'
      },
      entries: rows.map((r) => ({
        type: r.type,
        id: r.event_id,
        occurredAt: r.occurred_at,
        qtyIn: Number(r.qty_in),
        qtyOut: Number(r.qty_out),
        runningStock: Number(r.running_stock),
        supplierSource: r.supplier_source,
        referenceInvoiceNumber: r.reference_invoice_number,
        employeeIdentifier: r.employee_identifier,
        employeeName: r.employee_name,
        purposeProject: r.purpose_project
      })),
      page: safePage,
      pageSize: safePageSize,
      total
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const schema = z.object({
      itemIdentifier: z.string().trim().min(1).max(64),
      itemDescription: z.string().trim().min(1).max(255),
      minSafetyThreshold: z.number().int().min(0).default(0)
    });

    const input = schema.parse(req.body);

    const db = getPool();
    const [existing] = await db.query(`SELECT id FROM items WHERE item_identifier = ?`, [input.itemIdentifier]);
    if (existing.length > 0) return res.status(409).json({ error: 'Item Identifier already exists' });

    const [result] = await db.query(
      `
      INSERT INTO items (item_identifier, item_description, min_safety_threshold)
      VALUES (?, ?, ?)
      `,
      [input.itemIdentifier, input.itemDescription, input.minSafetyThreshold]
    );

    res.status(201).json({
      item: {
        id: result.insertId,
        itemIdentifier: input.itemIdentifier,
        itemDescription: input.itemDescription,
        minSafetyThreshold: input.minSafetyThreshold
      }
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid item id' });

    const schema = z.object({
      itemDescription: z.string().trim().min(1).max(255).optional(),
      minSafetyThreshold: z.number().int().min(0).optional(),
      isActive: z.boolean().optional()
    });

    const input = schema.parse(req.body);

    const item = await getItemCore(getPool(), id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const nextDescription = input.itemDescription ?? item.item_description;
    const nextThreshold =
      typeof input.minSafetyThreshold === 'number'
        ? input.minSafetyThreshold
        : Number(item.min_safety_threshold);
    const nextActive = typeof input.isActive === 'boolean' ? (input.isActive ? 1 : 0) : Number(item.is_active);

    await getPool().query(
      `
      UPDATE items
      SET item_description = ?, min_safety_threshold = ?, is_active = ?
      WHERE id = ?
      `,
      [nextDescription, nextThreshold, nextActive, id]
    );

    res.json({
      item: {
        id,
        itemIdentifier: item.item_identifier,
        itemDescription: nextDescription,
        minSafetyThreshold: nextThreshold,
        isActive: Boolean(nextActive)
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
