const Item = require('../models/Item');
const Purchase = require('../models/Purchase');
const Issuance = require('../models/Issuance');
const Employee = require('../models/Employee');

async function listItemsWithStock() {
  const items = await Item.find({ isActive: true }).sort({ itemIdentifier: 1 });
  
  const itemIds = items.map(item => item._id);
  
  const purchases = await Purchase.aggregate([
    { $match: { itemId: { $in: itemIds } } },
    { $group: { _id: '$itemId', totalReceived: { $sum: '$quantityReceived' } } }
  ]);
  
  const issuances = await Issuance.aggregate([
    { $match: { itemId: { $in: itemIds } } },
    { $group: { _id: '$itemId', totalIssued: { $sum: '$quantityIssued' } } }
  ]);
  
  const purchaseMap = new Map(purchases.map(p => [p._id.toString(), p.totalReceived]));
  const issuanceMap = new Map(issuances.map(i => [i._id.toString(), i.totalIssued]));
  
  return items.map(item => {
    const totalPurchased = purchaseMap.get(item._id.toString()) || 0;
    const totalIssued = issuanceMap.get(item._id.toString()) || 0;
    const currentStock = totalPurchased - totalIssued;
    
    return {
      id: item._id,
      itemIdentifier: item.itemIdentifier,
      itemDescription: item.itemDescription,
      minSafetyThreshold: item.minSafetyThreshold,
      totalPurchased: totalPurchased,
      totalIssued: totalIssued,
      currentStock: currentStock,
      stockStatus: currentStock <= item.minSafetyThreshold ? 'LOW STOCK' : 'GOOD'
    };
  });
}

async function getItemCore(itemId) {
  return await Item.findById(itemId);
}

async function getItemHistory(itemId) {
  const purchases = await Purchase.find({ itemId })
    .select('purchasedAt quantityReceived supplierSource referenceInvoiceNumber')
    .sort({ purchasedAt: 1, _id: 1 });
    
  const issuances = await Issuance.find({ itemId })
    .select('issuedAt quantityIssued issuedTo purposeProject')
    .sort({ issuedAt: 1, _id: 1 });
    
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
      purposeProject: null
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
      purposeProject: i.purposeProject
    }))
  ];
  
  events.sort((a, b) => {
    if (a.occurredAt.getTime() === b.occurredAt.getTime()) {
      if (a.type === b.type) return a.id < b.id ? -1 : 1;
      return a.type === 'PURCHASE' ? -1 : 1;
    }
    return a.occurredAt < b.occurredAt ? -1 : 1;
  });
  
  let running = 0;
  const ledger = events.map(e => {
    running += e.qtyIn;
    running -= e.qtyOut;
    return { ...e, runningStock: running };
  });
  
  return ledger;
}

async function getCurrentStockForUpdate(itemId) {
  const item = await Item.findById(itemId);
  if (!item) return null;
  
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
  
  return {
    itemId: item._id,
    minSafetyThreshold: item.minSafetyThreshold,
    totalPurchased: totalPurchased,
    totalIssued: totalIssued,
    currentStock: currentStock
  };
}

module.exports = {
  listItemsWithStock,
  getItemCore,
  getItemHistory,
  getCurrentStockForUpdate
};
