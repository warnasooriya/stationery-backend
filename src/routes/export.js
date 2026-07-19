const express = require('express');
const { z } = require('zod');
const { listItemsWithStock } = require('../services/inventory');
const { makeWorkbook, workbookToBuffer } = require('../utils/xlsx');
const Purchase = require('../models/Purchase');
const Issuance = require('../models/Issuance');
const Employee = require('../models/Employee');

const router = express.Router();

function sendWorkbook(res, { filename, workbook }) {
  const buffer = workbookToBuffer(workbook);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

router.get('/inventory', async (_req, res, next) => {
  try {
    const items = await listItemsWithStock();
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
    const querySchema = z.object({
      itemId: z.string().optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    });
    const q = querySchema.parse(req.query);

    const filter = {};
    if (q.itemId) {
      filter.itemId = q.itemId;
    }
    if (q.startDate) {
      const start = new Date(q.startDate);
      filter.purchasedAt = { ...filter.purchasedAt, $gte: start };
    }
    if (q.endDate) {
      const end = new Date(q.endDate + 'T23:59:59.999Z');
      filter.purchasedAt = { ...filter.purchasedAt, $lte: end };
    }

    const purchases = await Purchase.find(filter)
      .sort({ purchasedAt: -1, _id: -1 })
      .populate('itemId', 'itemIdentifier itemDescription');

    const exportRows = purchases.map((p) => ({
      Date: p.purchasedAt,
      'Item Identifier': p.itemId.itemIdentifier,
      'Item Description': p.itemId.itemDescription,
      'Quantity Received': p.quantityReceived,
      'Supplier/Source': p.supplierSource,
      'Reference Invoice Number': p.referenceInvoiceNumber
    }));

    const workbook = makeWorkbook({ sheetName: 'Purchases', rows: exportRows });
    sendWorkbook(res, { filename: 'purchases_log.xlsx', workbook });
  } catch (err) {
    next(err);
  }
});

router.get('/issuances', async (req, res, next) => {
  try {
    const querySchema = z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      employeeId: z.string().optional(),
      itemId: z.string().optional()
    });

    const q = querySchema.parse(req.query);

    const filter = {};
    if (q.startDate) {
      const start = new Date(q.startDate);
      filter.issuedAt = { ...filter.issuedAt, $gte: start };
    }
    if (q.endDate) {
      const end = new Date(q.endDate + 'T23:59:59.999Z');
      filter.issuedAt = { ...filter.issuedAt, $lte: end };
    }
    if (q.itemId) {
      filter.itemId = q.itemId;
    }

    let employeeIdentifier = null;
    if (q.employeeId) {
      const employee = await Employee.findById(q.employeeId);
      if (!employee || !employee.isActive) return res.status(404).json({ error: 'Employee not found' });
      employeeIdentifier = employee.employeeIdentifier;
      filter.issuedTo = employeeIdentifier;
    }

    const issuances = await Issuance.find(filter)
      .sort({ issuedAt: -1, _id: -1 })
      .populate('itemId', 'itemIdentifier');

    const issuedToIdentifiers = [...new Set(issuances.map(i => i.issuedTo))];
    const employees = await Employee.find({ employeeIdentifier: { $in: issuedToIdentifiers } });
    const employeeMap = new Map(employees.map(e => [e.employeeIdentifier, e]));

    const exportRows = issuances.map((i) => ({
      Date: i.issuedAt,
      'Item Identifier': i.itemId.itemIdentifier,
      'Quantity Issued': i.quantityIssued,
      'Issued To (Employee ID)': i.issuedTo,
      'Issued To (Employee Name)': employeeMap.get(i.issuedTo)?.employeeName || '',
      'Purpose/Project': i.purposeProject
    }));

    const workbook = makeWorkbook({ sheetName: 'Issuances', rows: exportRows });
    sendWorkbook(res, { filename: 'issuance_log.xlsx', workbook });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
