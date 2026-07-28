const express = require('express');
const { listItemsWithStock } = require('../services/inventory');
const Purchase = require('../models/Purchase');
const Issuance = require('../models/Issuance');
const Item = require('../models/Item');
const Employee = require('../models/Employee');

const router = express.Router();

function isoDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

router.get('/', async (_req, res, next) => {
  try {
    const { items } = await listItemsWithStock();
    const totalTrackedItems = items.length;
    const lowStockItems = items.filter((i) => i.stockStatus === 'LOW STOCK');

    const purchaseLogCount = await Purchase.countDocuments();
    const issuanceLogCount = await Issuance.countDocuments();
    const activeEmployeeCount = await Employee.countDocuments({ isActive: true });

    const topIssuedAgg = await Issuance.aggregate([
      {
        $group: {
          _id: '$itemId',
          qtyIssued: { $sum: '$quantityIssued' }
        }
      },
      { $sort: { qtyIssued: -1 } },
      { $limit: 5 }
    ]);
    
    const topIssuedItemIds = topIssuedAgg.map(t => t._id);
    const topIssuedItemsData = await Item.find({ _id: { $in: topIssuedItemIds } });
    const topIssuedItemsMap = new Map(topIssuedItemsData.map(i => [i._id.toString(), i]));
    const topIssuedItems = topIssuedAgg.map(t => ({
      itemId: t._id,
      itemIdentifier: topIssuedItemsMap.get(t._id.toString())?.itemIdentifier || '',
      itemDescription: topIssuedItemsMap.get(t._id.toString())?.itemDescription || '',
      quantityIssued: t.qtyIssued
    }));

    const topSuppliersAgg = await Purchase.aggregate([
      {
        $group: {
          _id: '$supplierSource',
          qtyReceived: { $sum: '$quantityReceived' },
          orderCount: { $sum: 1 }
        }
      },
      { $sort: { qtyReceived: -1 } },
      { $limit: 5 }
    ]);
    const topSuppliers = topSuppliersAgg.map(s => ({
      supplierSource: s._id,
      qtyReceived: s.qtyReceived,
      orderCount: s.orderCount
    }));

    const mostActiveEmployeesAgg = await Issuance.aggregate([
      {
        $group: {
          _id: '$issuedTo',
          qtyIssued: { $sum: '$quantityIssued' },
          issuanceCount: { $sum: 1 }
        }
      },
      { $sort: { qtyIssued: -1 } },
      { $limit: 5 }
    ]);
    const activeEmployeeIdentifiers = mostActiveEmployeesAgg.map(e => e._id);
    const activeEmployeesData = await Employee.find({ employeeIdentifier: { $in: activeEmployeeIdentifiers } });
    const activeEmployeesMap = new Map(activeEmployeesData.map(e => [e.employeeIdentifier, e]));
    const mostActiveEmployees = mostActiveEmployeesAgg.map(e => ({
      employeeIdentifier: e._id,
      employeeName: activeEmployeesMap.get(e._id)?.employeeName || null,
      employeeId: activeEmployeesMap.get(e._id)?._id || null,
      qtyIssued: e.qtyIssued,
      issuanceCount: e.issuanceCount
    }));

    const today = new Date();
    const thirteenDaysAgo = new Date(today);
    thirteenDaysAgo.setDate(today.getDate() - 13);
    thirteenDaysAgo.setHours(0, 0, 0, 0);

    const issuedByDayAgg = await Issuance.aggregate([
      { $match: { issuedAt: { $gte: thirteenDaysAgo } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$issuedAt' }
          },
          qty: { $sum: '$quantityIssued' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const purchasedByDayAgg = await Purchase.aggregate([
      { $match: { purchasedAt: { $gte: thirteenDaysAgo } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$purchasedAt' }
          },
          qty: { $sum: '$quantityReceived' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const issuedMap = new Map(issuedByDayAgg.map((r) => [r._id, Number(r.qty || 0)]));
    const purchasedMap = new Map(purchasedByDayAgg.map((r) => [r._id, Number(r.qty || 0)]));

    const days = [];
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(isoDate(d));
    }

    const activityByDay = days.map((d) => ({
      date: d,
      purchasedQty: purchasedMap.get(d) || 0,
      issuedQty: issuedMap.get(d) || 0
    }));

    const prevWeek = activityByDay.slice(0, 7);
    const thisWeek = activityByDay.slice(7, 14);
    const sumQty = (arr, key) => arr.reduce((acc, d) => acc + d[key], 0);
    const thisWeekPurchased = sumQty(thisWeek, 'purchasedQty');
    const prevWeekPurchased = sumQty(prevWeek, 'purchasedQty');
    const thisWeekIssued = sumQty(thisWeek, 'issuedQty');
    const prevWeekIssued = sumQty(prevWeek, 'issuedQty');

    function trendPct(current, previous) {
      if (previous === 0) return current === 0 ? 0 : 100;
      return Math.round(((current - previous) / previous) * 100);
    }

    const weeklyTrend = {
      thisWeekPurchased,
      prevWeekPurchased,
      purchasedTrendPct: trendPct(thisWeekPurchased, prevWeekPurchased),
      thisWeekIssued,
      prevWeekIssued,
      issuedTrendPct: trendPct(thisWeekIssued, prevWeekIssued),
      netChangeThisWeek: thisWeekPurchased - thisWeekIssued
    };

    const purchases = await Purchase.find()
      .sort({ purchasedAt: -1, _id: -1 })
      .limit(12)
      .populate('itemId', 'itemIdentifier itemDescription');

    const issuances = await Issuance.find()
      .sort({ issuedAt: -1, _id: -1 })
      .limit(12)
      .populate('itemId', 'itemIdentifier itemDescription');

    const issuedToIdentifiers = [...new Set(issuances.map(i => i.issuedTo))];
    const employees = await Employee.find({ employeeIdentifier: { $in: issuedToIdentifiers } });
    const employeeMap = new Map(employees.map(e => [e.employeeIdentifier, e]));

    const events = [
      ...purchases.map(p => ({
        type: 'PURCHASE',
        id: p._id,
        occurredAt: p.purchasedAt,
        itemIdentifier: p.itemId.itemIdentifier,
        itemDescription: p.itemId.itemDescription,
        quantity: p.quantityReceived,
        employeeIdentifier: null,
        employeeName: null,
        supplierSource: p.supplierSource,
        referenceInvoiceNumber: p.referenceInvoiceNumber,
        purposeProject: null,
        typeSort: 0
      })),
      ...issuances.map(i => ({
        type: 'ISSUE',
        id: i._id,
        occurredAt: i.issuedAt,
        itemIdentifier: i.itemId.itemIdentifier,
        itemDescription: i.itemId.itemDescription,
        quantity: i.quantityIssued,
        employeeIdentifier: i.issuedTo,
        employeeName: employeeMap.get(i.issuedTo)?.employeeName || null,
        supplierSource: null,
        referenceInvoiceNumber: null,
        purposeProject: i.purposeProject,
        typeSort: 1
      }))
    ];

    const sortedEvents = events.sort((a, b) => {
      if (a.occurredAt.getTime() === b.occurredAt.getTime()) {
        if (a.typeSort === b.typeSort) return a.id < b.id ? 1 : -1;
        return b.typeSort - a.typeSort;
      }
      return b.occurredAt - a.occurredAt;
    });

    const recentActivity = sortedEvents.slice(0, 12).map(e => ({
      type: e.type,
      id: e.id,
      occurredAt: isoDate(e.occurredAt),
      itemIdentifier: e.itemIdentifier,
      itemDescription: e.itemDescription,
      quantity: e.quantity,
      employeeIdentifier: e.employeeIdentifier,
      employeeName: e.employeeName,
      supplierSource: e.supplierSource,
      referenceInvoiceNumber: e.referenceInvoiceNumber,
      purposeProject: e.purposeProject
    }));

    res.json({
      stats: {
        totalTrackedItems,
        lowStockCount: lowStockItems.length,
        purchaseLogCount,
        issuanceLogCount,
        activeEmployeeCount,
        ...weeklyTrend
      },
      widgets: {
        lowStockItems: lowStockItems.slice(0, 8).map((i) => ({
          id: i.id,
          itemIdentifier: i.itemIdentifier,
          itemDescription: i.itemDescription,
          currentStock: i.currentStock,
          minSafetyThreshold: i.minSafetyThreshold
        })),
        stockHealth: {
          healthyCount: totalTrackedItems - lowStockItems.length,
          lowCount: lowStockItems.length,
          totalCount: totalTrackedItems
        },
        topIssuedItems,
        topSuppliers,
        mostActiveEmployees,
        activityByDay,
        recentActivity
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
