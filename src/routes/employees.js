const express = require('express');
const { z } = require('zod');
const Employee = require('../models/Employee');
const Issuance = require('../models/Issuance');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const querySchema = z.object({
      search: z.string().trim().optional(),
      page: z.string().optional(),
      pageSize: z.string().optional()
    });
    const q = querySchema.parse(req.query);

    const filter = { isActive: true };
    if (q.search) {
      const re = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ employeeIdentifier: re }, { employeeName: re }];
    }

    if (q.page || q.pageSize) {
      const page = q.page ? Number(q.page) : 1;
      const pageSize = q.pageSize ? Number(q.pageSize) : 10;
      const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
      const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(200, Math.floor(pageSize)) : 10;
      const skip = (safePage - 1) * safePageSize;

      const total = await Employee.countDocuments(filter);
      const employees = await Employee.find(filter)
        .sort({ employeeIdentifier: 1 })
        .skip(skip)
        .limit(safePageSize)
        .select('employeeIdentifier employeeName isActive');

      return res.json({
        employees: employees.map(e => ({
          id: e._id,
          employeeIdentifier: e.employeeIdentifier,
          employeeName: e.employeeName
        })),
        page: safePage,
        pageSize: safePageSize,
        total
      });
    }

    const employees = await Employee.find(filter)
      .sort({ employeeIdentifier: 1 })
      .select('employeeIdentifier employeeName');

    res.json({
      employees: employees.map(e => ({
        id: e._id,
        employeeIdentifier: e.employeeIdentifier,
        employeeName: e.employeeName
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

    const existing = await Employee.findOne({ employeeIdentifier: input.employeeIdentifier });
    if (existing) return res.status(409).json({ error: 'Employee Identifier already exists' });

    const employee = await Employee.create({
      employeeIdentifier: input.employeeIdentifier,
      employeeName: input.employeeName
    });

    res.status(201).json({
      employee: {
        id: employee._id,
        employeeIdentifier: employee.employeeIdentifier,
        employeeName: employee.employeeName
      }
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const schema = z.object({
      employeeName: z.string().trim().min(1).max(255).optional(),
      isActive: z.boolean().optional()
    });
    const input = schema.parse(req.body);

    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    if (input.employeeName !== undefined) employee.employeeName = input.employeeName;
    if (input.isActive !== undefined) employee.isActive = input.isActive;
    await employee.save();

    res.json({
      employee: {
        id: employee._id,
        employeeIdentifier: employee.employeeIdentifier,
        employeeName: employee.employeeName,
        isActive: employee.isActive
      }
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const hasIssuance = await Issuance.exists({ issuedTo: employee.employeeIdentifier });
    if (hasIssuance) {
      return res.status(409).json({
        error: 'Cannot delete — this employee has issuance history. Use the Active/Inactive toggle instead.'
      });
    }

    await Employee.findByIdAndDelete(employee._id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
