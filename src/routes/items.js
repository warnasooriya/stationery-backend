const express = require('express');
const { z } = require('zod');
const { listItemsWithStock, getItemCore, getItemHistory } = require('../services/inventory');
const Item = require('../models/Item');
const Purchase = require('../models/Purchase');
const Issuance = require('../models/Issuance');
const Employee = require('../models/Employee');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const items = await listItemsWithStock();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const item = await getItemCore(req.params.id);
    if (!item || !item.isActive) return res.status(404).json({ error: 'Item not found' });

    res.json({
      item: {
        id: item._id,
        itemIdentifier: item.itemIdentifier,
        itemDescription: item.itemDescription,
        minSafetyThreshold: item.minSafetyThreshold
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/history', async (req, res, next) => {
  try {
    const item = await getItemCore(req.params.id);
    if (!item || !item.isActive) return res.status(404).json({ error: 'Item not found' });

    const history = await getItemHistory(req.params.id);
    res.json({
      item: {
        id: item._id,
        itemIdentifier: item.itemIdentifier,
        itemDescription: item.itemDescription,
        minSafetyThreshold: item.minSafetyThreshold
      },
      history
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/bin-card', async (req, res, next) => {
  try {
    const querySchema = z.object({
      page: z.string().optional(),
      pageSize: z.string().optional()
    });
    const q = querySchema.parse(req.query);

    const page = q.page ? Number(q.page) : 1;
    const pageSize = q.pageSize ? Number(q.pageSize) : 25;
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(200, Math.floor(pageSize)) : 25;
    const skip = (safePage - 1) * safePageSize;

    const item = await getItemCore(req.params.id);
    if (!item || !item.isActive) return res.status(404).json({ error: 'Item not found' });

    const [purchaseResult] = await Purchase.aggregate([
      { $match: { itemId: item._id } },
      { $group: { _id: null, totalReceived: { $sum: '$quantityReceived' } } }
    ]);
    const [issuanceResult] = await Issuance.aggregate([
      { $match: { itemId: item._id } },
      { $group: { _id: null, totalIssued: { $sum: '$quantityIssued' } } }
    ]);
    const totalPurchased = purchaseResult?.totalReceived || 0;
    const totalIssued = issuanceResult?.totalIssued || 0;
    const currentStock = totalPurchased - totalIssued;
    const minSafetyThreshold = item.minSafetyThreshold;

    const purchases = await Purchase.find({ itemId: item._id })
      .select('purchasedAt quantityReceived supplierSource referenceInvoiceNumber');
    const issuances = await Issuance.find({ itemId: item._id })
      .select('issuedAt quantityIssued issuedTo purposeProject');

    const employeeIdentifiers = [...new Set(issuances.map(i => i.issuedTo))];
    const employees = await Employee.find({ employeeIdentifier: { $in: employeeIdentifiers } })
      .select('employeeIdentifier employeeName');
    const employeeMap = new Map(employees.map(e => [e.employeeIdentifier, e.employeeName]));

    const events = [
      ...purchases.map(p => ({
        type: 'PURCHASE',
        id: p._id,
        occurredAt: p.purchasedAt,
        qtyIn: p.quantityReceived,
        qtyOut: 0,
        supplierSource: p.supplierSource,
        referenceInvoiceNumber: p.referenceInvoiceNumber,
        employeeIdentifier: null,
        employeeName: null,
        purposeProject: null,
        typeSort: 0
      })),
      ...issuances.map(i => ({
        type: 'ISSUE',
        id: i._id,
        occurredAt: i.issuedAt,
        qtyIn: 0,
        qtyOut: i.quantityIssued,
        supplierSource: null,
        referenceInvoiceNumber: null,
        employeeIdentifier: i.issuedTo,
        employeeName: employeeMap.get(i.issuedTo) || null,
        purposeProject: i.purposeProject,
        typeSort: 1
      }))
    ];

    let running = 0;
    const sortedEvents = events.sort((a, b) => {
      if (a.occurredAt.getTime() === b.occurredAt.getTime()) {
        if (a.typeSort === b.typeSort) return a.id < b.id ? -1 : 1;
        return a.typeSort - b.typeSort;
      }
      return a.occurredAt < b.occurredAt ? -1 : 1;
    });
    const eventsWithStock = sortedEvents.map(e => {
      running += e.qtyIn;
      running -= e.qtyOut;
      return { ...e, runningStock: running };
    });
    const reversedEvents = eventsWithStock.reverse();
    const total = reversedEvents.length;
    const paginatedEvents = reversedEvents.slice(skip, skip + safePageSize);

    res.json({
      item: {
        id: item._id,
        itemIdentifier: item.itemIdentifier,
        itemDescription: item.itemDescription,
        minSafetyThreshold,
        totalPurchased,
        totalIssued,
        currentStock,
        stockStatus: currentStock <= minSafetyThreshold ? 'LOW STOCK' : 'GOOD'
      },
      entries: paginatedEvents.map(e => ({
        type: e.type,
        id: e.id,
        occurredAt: e.occurredAt,
        qtyIn: e.qtyIn,
        qtyOut: e.qtyOut,
        runningStock: e.runningStock,
        supplierSource: e.supplierSource,
        referenceInvoiceNumber: e.referenceInvoiceNumber,
        employeeIdentifier: e.employeeIdentifier,
        employeeName: e.employeeName,
        purposeProject: e.purposeProject
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

    const existing = await Item.findOne({ itemIdentifier: input.itemIdentifier });
    if (existing) return res.status(409).json({ error: 'Item Identifier already exists' });

    const item = await Item.create({
      itemIdentifier: input.itemIdentifier,
      itemDescription: input.itemDescription,
      minSafetyThreshold: input.minSafetyThreshold
    });

    res.status(201).json({
      item: {
        id: item._id,
        itemIdentifier: item.itemIdentifier,
        itemDescription: item.itemDescription,
        minSafetyThreshold: item.minSafetyThreshold
      }
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const schema = z.object({
      itemDescription: z.string().trim().min(1).max(255).optional(),
      minSafetyThreshold: z.number().int().min(0).optional(),
      isActive: z.boolean().optional()
    });

    const input = schema.parse(req.body);

    const item = await getItemCore(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const updateData = {};
    if (input.itemDescription !== undefined) updateData.itemDescription = input.itemDescription;
    if (input.minSafetyThreshold !== undefined) updateData.minSafetyThreshold = input.minSafetyThreshold;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;

    const updatedItem = await Item.findByIdAndUpdate(req.params.id, updateData, { new: true });

    res.json({
      item: {
        id: updatedItem._id,
        itemIdentifier: updatedItem.itemIdentifier,
        itemDescription: updatedItem.itemDescription,
        minSafetyThreshold: updatedItem.minSafetyThreshold,
        isActive: updatedItem.isActive
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
