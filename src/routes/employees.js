const express = require('express');
const { z } = require('zod');
const Employee = require('../models/Employee');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const employees = await Employee.find({ isActive: true })
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

module.exports = router;
