const express = require('express');
const { z } = require('zod');
const { getPool } = require('../db');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const db = getPool();
    const [rows] = await db.query(
      `
      SELECT id, employee_identifier, employee_name
      FROM employees
      WHERE is_active = 1
      ORDER BY employee_identifier ASC
      `
    );

    res.json({
      employees: rows.map((r) => ({
        id: r.id,
        employeeIdentifier: r.employee_identifier,
        employeeName: r.employee_name
      }))
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const schema = z.object({
      employeeIdentifier: z.string().trim().min(1).max(64),
      employeeName: z.string().trim().min(1).max(255)
    });
    const input = schema.parse(req.body);

    const db = getPool();
    const [existing] = await db.query(`SELECT id FROM employees WHERE employee_identifier = ?`, [
      input.employeeIdentifier
    ]);
    if (existing.length > 0) return res.status(409).json({ error: 'Employee Identifier already exists' });

    const [result] = await db.query(
      `
      INSERT INTO employees (employee_identifier, employee_name)
      VALUES (?, ?)
      `,
      [input.employeeIdentifier, input.employeeName]
    );

    res.status(201).json({
      employee: {
        id: result.insertId,
        employeeIdentifier: input.employeeIdentifier,
        employeeName: input.employeeName
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

