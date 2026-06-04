const express = require('express');
const { z } = require('zod');
const { withTransaction, getPool } = require('../db');
const { getCurrentStockForUpdate } = require('../services/inventory');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const querySchema = z.object({
      itemId: z.string().optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      employeeId: z.string().optional(),
      page: z.string().optional(),
      pageSize: z.string().optional()
    });

    const q = querySchema.parse(req.query);

    const itemId = q.itemId ? Number(q.itemId) : null;
    const employeeId = q.employeeId ? Number(q.employeeId) : null;
    const startDate = q.startDate || null;
    const endDate = q.endDate || null;

    const page = q.page ? Number(q.page) : 1;
    const pageSize = q.pageSize ? Number(q.pageSize) : 25;

    if (itemId !== null && !Number.isFinite(itemId)) return res.status(400).json({ error: 'Invalid itemId' });
    if (employeeId !== null && !Number.isFinite(employeeId)) return res.status(400).json({ error: 'Invalid employeeId' });

    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safePageSize =
      Number.isFinite(pageSize) && pageSize > 0 ? Math.min(200, Math.floor(pageSize)) : 25;
    const offset = (safePage - 1) * safePageSize;

    const db = getPool();

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

    if (itemId !== null) {
      where.push('s.item_id = ?');
      params.push(itemId);
    }
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

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [countRows] = await db.query(
      `
      SELECT COUNT(*) AS c
      FROM issuance_log s
      ${whereSql}
      `,
      params
    );
    const total = Number(countRows[0]?.c || 0);

    const [rows] = await db.query(
      `
      SELECT
        s.id,
        s.issued_at,
        s.item_id,
        i.item_identifier,
        i.item_description,
        s.quantity_issued,
        s.issued_to,
        e.id AS employee_id,
        e.employee_name,
        s.purpose_project
      FROM issuance_log s
      INNER JOIN items i ON i.id = s.item_id
      LEFT JOIN employees e ON e.employee_identifier = s.issued_to AND e.is_active = 1
      ${whereSql}
      ORDER BY s.issued_at DESC, s.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, safePageSize, offset]
    );

    res.json({
      issuances: rows.map((r) => ({
        id: r.id,
        issuedAt: r.issued_at,
        itemId: r.item_id,
        itemIdentifier: r.item_identifier,
        itemDescription: r.item_description,
        quantityIssued: Number(r.quantity_issued),
        employeeId: r.employee_id || null,
        employeeIdentifier: r.issued_to,
        employeeName: r.employee_name || null,
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
      issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      itemId: z.number().int().positive(),
      quantityIssued: z.number().int().positive(),
      employeeId: z.number().int().positive(),
      purposeProject: z.string().trim().min(1).max(255)
    });

    const input = schema.parse(req.body);

    const result = await withTransaction(async (connection) => {
      const [employeeRows] = await connection.query(
        `
        SELECT id, employee_identifier, employee_name
        FROM employees
        WHERE id = ? AND is_active = 1
        `,
        [input.employeeId]
      );
      const employee = employeeRows[0];
      if (!employee) return { status: 404, body: { error: 'Employee not found' } };

      const stock = await getCurrentStockForUpdate(connection, input.itemId);
      if (!stock) return { status: 404, body: { error: 'Item not found' } };

      if (input.quantityIssued > stock.currentStock) {
        return {
          status: 400,
          body: {
            error: 'Insufficient stock for issuance',
            currentStock: stock.currentStock
          }
        };
      }

      const [inserted] = await connection.query(
        `
        INSERT INTO issuance_log (
          issued_at, item_id, quantity_issued, issued_to, department, purpose_project
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          input.issuedAt,
          input.itemId,
          input.quantityIssued,
          employee.employee_identifier,
          '',
          input.purposeProject
        ]
      );

      return {
        status: 201,
        body: {
          issuance: {
            id: inserted.insertId,
            issuedAt: input.issuedAt,
            itemId: input.itemId,
            quantityIssued: input.quantityIssued,
            employeeId: employee.id,
            employeeIdentifier: employee.employee_identifier,
            employeeName: employee.employee_name,
            purposeProject: input.purposeProject
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
