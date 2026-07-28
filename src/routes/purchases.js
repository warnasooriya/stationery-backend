const express = require('express');
const { z } = require('zod');
const Purchase = require('../models/Purchase');
const Item = require('../models/Item');
const Issuance = require('../models/Issuance');

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

    const itemId = q.itemId || null;
    const startDate = q.startDate ? new Date(q.startDate) : null;
    const endDate = q.endDate ? new Date(q.endDate + 'T23:59:59.999Z') : null;

    const page = q.page ? Number(q.page) : 1;
    const pageSize = q.pageSize ? Number(q.pageSize) : 10;
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(200, Math.floor(pageSize)) : 10;
    const skip = (safePage - 1) * safePageSize;

    const filter = {};
    if (itemId) filter.itemId = itemId;
    if (startDate) filter.purchasedAt = { ...filter.purchasedAt, $gte: startDate };
    if (endDate) filter.purchasedAt = { ...filter.purchasedAt, $lte: endDate };

    const total = await Purchase.countDocuments(filter);

    const purchases = await Purchase.find(filter)
      .sort({ purchasedAt: -1, _id: -1 })
      .skip(skip)
      .limit(safePageSize)
      .populate('itemId', 'itemIdentifier itemDescription');

    res.json({
      purchases: purchases.map(p => ({
        id: p._id,
        purchasedAt: p.purchasedAt,
        itemId: p.itemId._id,
        itemIdentifier: p.itemId.itemIdentifier,
        itemDescription: p.itemId.itemDescription,
        quantityReceived: p.quantityReceived,
        supplierSource: p.supplierSource,
        referenceInvoiceNumber: p.referenceInvoiceNumber
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
      itemId: z.string().optional(),
      itemIdentifier: z.string().trim().min(1).max(64).optional(),
      itemDescription: z.string().trim().min(1).max(255).optional(),
      minSafetyThreshold: z.number().int().min(0).optional(),
      quantityReceived: z.number().int().positive(),
      supplierSource: z.string().trim().min(1).max(255),
      referenceInvoiceNumber: z.string().trim().min(1).max(128)
    });

    const input = schema.parse(req.body);

    let item;
    if (input.itemId) {
      item = await Item.findById(input.itemId);
      if (!item || !item.isActive) return res.status(404).json({ error: 'Item not found' });
    } else {
      if (!input.itemIdentifier) {
        return res.status(400).json({ error: 'Provide itemId or itemIdentifier' });
      }
      
      item = await Item.findOne({ itemIdentifier: input.itemIdentifier, isActive: true });
      if (!item) {
        if (!input.itemDescription) {
          return res.status(400).json({ error: 'itemDescription required when creating a new item' });
        }
        const minSafetyThreshold = Number.isFinite(input.minSafetyThreshold) ? input.minSafetyThreshold : 0;
        item = await Item.create({
          itemIdentifier: input.itemIdentifier,
          itemDescription: input.itemDescription,
          minSafetyThreshold
        });
      }
    }

    const purchase = await Purchase.create({
      purchasedAt: new Date(input.purchasedAt),
      itemId: item._id,
      quantityReceived: input.quantityReceived,
      supplierSource: input.supplierSource,
      referenceInvoiceNumber: input.referenceInvoiceNumber
    });

    res.status(201).json({
      purchase: {
        id: purchase._id,
        purchasedAt: purchase.purchasedAt,
        itemId: purchase.itemId,
        quantityReceived: purchase.quantityReceived,
        supplierSource: purchase.supplierSource,
        referenceInvoiceNumber: purchase.referenceInvoiceNumber
      }
    });
  } catch (err) {
    next(err);
  }
});

async function getItemTotals(itemId) {
  const [purchaseResult] = await Purchase.aggregate([
    { $match: { itemId } },
    { $group: { _id: null, totalReceived: { $sum: '$quantityReceived' } } }
  ]);
  const [issuanceResult] = await Issuance.aggregate([
    { $match: { itemId } },
    { $group: { _id: null, totalIssued: { $sum: '$quantityIssued' } } }
  ]);
  return {
    totalPurchased: purchaseResult?.totalReceived || 0,
    totalIssued: issuanceResult?.totalIssued || 0
  };
}

router.patch('/:id', async (req, res, next) => {
  try {
    const schema = z.object({
      purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      quantityReceived: z.number().int().positive().optional(),
      supplierSource: z.string().trim().min(1).max(255).optional(),
      referenceInvoiceNumber: z.string().trim().min(1).max(128).optional()
    });
    const input = schema.parse(req.body);

    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

    if (input.quantityReceived !== undefined && input.quantityReceived !== purchase.quantityReceived) {
      const { totalPurchased, totalIssued } = await getItemTotals(purchase.itemId);
      const newTotalPurchased = totalPurchased - purchase.quantityReceived + input.quantityReceived;
      if (newTotalPurchased < totalIssued) {
        return res.status(400).json({
          error: 'Cannot reduce quantity — would result in negative stock for this item',
          totalIssued,
          maxQuantityReceived: input.quantityReceived - (newTotalPurchased - totalIssued)
        });
      }
      purchase.quantityReceived = input.quantityReceived;
    }

    if (input.purchasedAt !== undefined) purchase.purchasedAt = new Date(input.purchasedAt);
    if (input.supplierSource !== undefined) purchase.supplierSource = input.supplierSource;
    if (input.referenceInvoiceNumber !== undefined) purchase.referenceInvoiceNumber = input.referenceInvoiceNumber;

    await purchase.save();

    res.json({
      purchase: {
        id: purchase._id,
        purchasedAt: purchase.purchasedAt,
        itemId: purchase.itemId,
        quantityReceived: purchase.quantityReceived,
        supplierSource: purchase.supplierSource,
        referenceInvoiceNumber: purchase.referenceInvoiceNumber
      }
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

    const { totalPurchased, totalIssued } = await getItemTotals(purchase.itemId);
    const remainingAfterDelete = totalPurchased - purchase.quantityReceived;
    if (remainingAfterDelete < totalIssued) {
      return res.status(400).json({
        error: 'Cannot delete — would result in negative stock for this item'
      });
    }

    await Purchase.findByIdAndDelete(purchase._id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
