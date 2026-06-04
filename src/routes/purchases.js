const express = require('express');
const { z } = require('zod');
const { getPool, withTransaction } = require('../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const querySchema = z.object({
      itemId: z.string().optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      page: z.string().optional(),
      pageSize: z.string().optional()
    });
    const q = querySchema.parse(req.query);

    const itemId = q.itemId ? Number(q.itemId) : null;
    const startDate = q.startDate || null;
    const endDate = q.endDate || null;

    const page = q.page ? Number(q.page) : 1;
    const pageSize = q.pageSize ? Number(q.pageSize) : 25;

    if (itemId !== null && !Number.isFinite(itemId)) return res.status(400).json({ error: 'Invalid itemId' });

    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safePageSize =
      Number.isFinite(pageSize) && pageSize > 0 ? Math.min(200, Math.floor(pageSize)) : 25;
    const offset = (safePage - 1) * safePageSize;

    const db = getPool();

    const where = [];
    const params = [];
    if (itemId !== null) {
      where.push('p.item_id = ?');
      params.push(itemId);
    }
    if (startDate) {
      where.push('p.purchased_at >= ?');
      params.push(startDate);
    }
    if (endDate) {
      where.push('p.purchased_at <= ?');
      params.push(endDate);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [countRows] = await db.query(
      `
      SELECT COUNT(*) AS c
      FROM purchases_log p
      ${whereSql}
      `,
      params
    );
    const total = Number(countRows[0]?.c || 0);

    const [rows] = await db.query(
      `
      SELECT
        p.id,
        p.purchased_at,
        p.item_id,
        i.item_identifier,
        i.item_description,
        p.quantity_received,
        p.supplier_source,
        p.reference_invoice_number
      FROM purchases_log p
      INNER JOIN items i ON i.id = p.item_id
      ${whereSql}
      ORDER BY p.purchased_at DESC, p.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, safePageSize, offset]
    );

    res.json({
      purchases: rows.map((r) => ({
        id: r.id,
        purchasedAt: r.purchased_at,
        itemId: r.item_id,
        itemIdentifier: r.item_identifier,
        itemDescription: r.item_description,
        quantityReceived: Number(r.quantity_received),
        supplierSource: r.supplier_source,
        referenceInvoiceNumber: r.reference_invoice_number
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
      purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      itemId: z.number().int().positive().optional(),
      itemIdentifier: z.string().trim().min(1).max(64).optional(),
      itemDescription: z.string().trim().min(1).max(255).optional(),
      minSafetyThreshold: z.number().int().min(0).optional(),
      quantityReceived: z.number().int().positive(),
      supplierSource: z.string().trim().min(1).max(255),
      referenceInvoiceNumber: z.string().trim().min(1).max(128)
    });

    const input = schema.parse(req.body);

    const result = await withTransaction(async (connection) => {
      let itemId = input.itemId;

      if (!itemId) {
        if (!input.itemIdentifier) {
          return { status: 400, body: { error: 'Provide itemId or itemIdentifier' } };
        }

        const [existing] = await connection.query(
          `SELECT id FROM items WHERE item_identifier = ? AND is_active = 1`,
          [input.itemIdentifier]
        );

        if (existing.length > 0) {
          itemId = existing[0].id;
        } else {
          if (!input.itemDescription) {
            return { status: 400, body: { error: 'itemDescription required when creating a new item' } };
          }

          const minSafetyThreshold = Number.isFinite(input.minSafetyThreshold)
            ? input.minSafetyThreshold
            : 0;

          const [created] = await connection.query(
            `
            INSERT INTO items (item_identifier, item_description, min_safety_threshold)
            VALUES (?, ?, ?)
            `,
            [input.itemIdentifier, input.itemDescription, minSafetyThreshold]
          );
          itemId = created.insertId;
        }
      }

      const [inserted] = await connection.query(
        `
        INSERT INTO purchases_log (
          purchased_at, item_id, quantity_received, supplier_source, reference_invoice_number
        )
        VALUES (?, ?, ?, ?, ?)
        `,
        [
          input.purchasedAt,
          itemId,
          input.quantityReceived,
          input.supplierSource,
          input.referenceInvoiceNumber
        ]
      );

      return {
        status: 201,
        body: {
          purchase: {
            id: inserted.insertId,
            purchasedAt: input.purchasedAt,
            itemId,
            quantityReceived: input.quantityReceived,
            supplierSource: input.supplierSource,
            referenceInvoiceNumber: input.referenceInvoiceNumber
          }
        }
      };
    });

    res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
