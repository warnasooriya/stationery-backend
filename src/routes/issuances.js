const express = require('express');
const { z } = require('zod');
const Issuance = require('../models/Issuance');
const Employee = require('../models/Employee');
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

    const itemId = q.itemId || null;
    const employeeId = q.employeeId || null;
    const startDate = q.startDate ? new Date(q.startDate) : null;
    const endDate = q.endDate ? new Date(q.endDate + 'T23:59:59.999Z') : null;

    const page = q.page ? Number(q.page) : 1;
    const pageSize = q.pageSize ? Number(q.pageSize) : 25;
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(200, Math.floor(pageSize)) : 25;
    const skip = (safePage - 1) * safePageSize;

    let employeeIdentifier = null;
    if (employeeId) {
      const employee = await Employee.findById(employeeId);
      if (!employee || !employee.isActive) return res.status(404).json({ error: 'Employee not found' });
      employeeIdentifier = employee.employeeIdentifier;
    }

    const filter = {};
    if (itemId) filter.itemId = itemId;
    if (employeeIdentifier) filter.issuedTo = employeeIdentifier;
    if (startDate) filter.issuedAt = { ...filter.issuedAt, $gte: startDate };
    if (endDate) filter.issuedAt = { ...filter.issuedAt, $lte: endDate };

    const total = await Issuance.countDocuments(filter);

    const issuances = await Issuance.find(filter)
      .sort({ issuedAt: -1, _id: -1 })
      .skip(skip)
      .limit(safePageSize)
      .populate('itemId', 'itemIdentifier itemDescription');

    const issuedToIdentifiers = [...new Set(issuances.map(i => i.issuedTo))];
    const employees = await Employee.find({ employeeIdentifier: { $in: issuedToIdentifiers } });
    const employeeMap = new Map(employees.map(e => [e.employeeIdentifier, e]));

    res.json({
      issuances: issuances.map(i => {
        const emp = employeeMap.get(i.issuedTo);
        return {
          id: i._id,
          issuedAt: i.issuedAt,
          itemId: i.itemId._id,
          itemIdentifier: i.itemId.itemIdentifier,
          itemDescription: i.itemId.itemDescription,
          quantityIssued: i.quantityIssued,
          employeeId: emp?._id || null,
          employeeIdentifier: i.issuedTo,
          employeeName: emp?.employeeName || null,
          purposeProject: i.purposeProject
        };
      }),
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
      itemId: z.string(),
      quantityIssued: z.number().int().positive(),
      employeeId: z.string(),
      purposeProject: z.string().trim().min(1).max(255)
    });

    const input = schema.parse(req.body);

    const employee = await Employee.findById(input.employeeId);
    if (!employee || !employee.isActive) return { status: 404, body: { error: 'Employee not found' } };

    const stock = await getCurrentStockForUpdate(input.itemId);
    if (!stock) return { status: 404, body: { error: 'Item not found' } };

    if (input.quantityIssued > stock.currentStock) {
      return res.status(400).json({
        error: 'Insufficient stock for issuance',
        currentStock: stock.currentStock
      });
    }

    const issuance = await Issuance.create({
      issuedAt: new Date(input.issuedAt),
      itemId: input.itemId,
      quantityIssued: input.quantityIssued,
      issuedTo: employee.employeeIdentifier,
      department: '',
      purposeProject: input.purposeProject
    });

    res.status(201).json({
      issuance: {
        id: issuance._id,
        issuedAt: issuance.issuedAt,
        itemId: issuance.itemId,
        quantityIssued: issuance.quantityIssued,
        employeeId: employee._id,
        employeeIdentifier: employee.employeeIdentifier,
        employeeName: employee.employeeName,
        purposeProject: issuance.purposeProject
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
