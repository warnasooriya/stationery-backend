const express = require('express');
const { getPool } = require('../db');
const { listItemsWithStock } = require('../services/inventory');

const router = express.Router();

function isoDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

router.get('/', async (_req, res, next) => {
  try {
    const db = getPool();
    const items = await listItemsWithStock(db);
    const totalTrackedItems = items.length;
    const lowStockItems = items.filter((i) => i.stockStatus === 'LOW STOCK');

    const [purchaseCountRows] = await db.query(`SELECT COUNT(*) AS c FROM purchases_log`);
    const [issuanceCountRows] = await db.query(`SELECT COUNT(*) AS c FROM issuance_log`);

    const [topIssuedRows] = await db.query(
      `
      SELECT
        i.id AS item_id,
        i.item_identifier,
        i.item_description,
        SUM(s.quantity_issued) AS qty_issued
      FROM issuance_log s
      INNER JOIN items i ON i.id = s.item_id
      GROUP BY i.id, i.item_identifier, i.item_description
      ORDER BY qty_issued DESC
      LIMIT 5
      `
    );

    const [issuedByDayRows] = await db.query(
      `
      SELECT issued_at AS d, SUM(quantity_issued) AS qty
      FROM issuance_log
      WHERE issued_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
      GROUP BY issued_at
      ORDER BY issued_at ASC
      `
    );

    const [purchasedByDayRows] = await db.query(
      `
      SELECT purchased_at AS d, SUM(quantity_received) AS qty
      FROM purchases_log
      WHERE purchased_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
      GROUP BY purchased_at
      ORDER BY purchased_at ASC
      `
    );

    const issuedMap = new Map(issuedByDayRows.map((r) => [r.d, Number(r.qty || 0)]));
    const purchasedMap = new Map(purchasedByDayRows.map((r) => [r.d, Number(r.qty || 0)]));

    const today = new Date();
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

    const [recentActivityRows] = await db.query(
      `
      SELECT *
      FROM (
        SELECT
          'PURCHASE' AS type,
          p.id AS event_id,
          p.purchased_at AS occurred_at,
          i.item_identifier,
          i.item_description,
          p.quantity_received AS quantity,
          NULL AS employee_identifier,
          NULL AS employee_name,
          NULL AS supplier_source,
          p.reference_invoice_number AS reference_invoice_number,
          NULL AS purpose_project,
          0 AS type_sort
        FROM purchases_log p
        INNER JOIN items i ON i.id = p.item_id
        UNION ALL
        SELECT
          'ISSUE' AS type,
          s.id AS event_id,
          s.issued_at AS occurred_at,
          i.item_identifier,
          i.item_description,
          s.quantity_issued AS quantity,
          s.issued_to AS employee_identifier,
          e.employee_name AS employee_name,
          NULL AS supplier_source,
          NULL AS reference_invoice_number,
          s.purpose_project AS purpose_project,
          1 AS type_sort
        FROM issuance_log s
        INNER JOIN items i ON i.id = s.item_id
        LEFT JOIN employees e ON e.employee_identifier = s.issued_to AND e.is_active = 1
      ) x
      ORDER BY occurred_at DESC, type_sort DESC, event_id DESC
      LIMIT 12
      `
    );

    res.json({
      stats: {
        totalTrackedItems,
        lowStockCount: lowStockItems.length,
        purchaseLogCount: Number(purchaseCountRows[0]?.c || 0),
        issuanceLogCount: Number(issuanceCountRows[0]?.c || 0)
      },
      widgets: {
        lowStockItems: lowStockItems.slice(0, 8).map((i) => ({
          id: i.id,
          itemIdentifier: i.itemIdentifier,
          itemDescription: i.itemDescription,
          currentStock: i.currentStock,
          minSafetyThreshold: i.minSafetyThreshold
        })),
        topIssuedItems: topIssuedRows.map((r) => ({
          itemId: r.item_id,
          itemIdentifier: r.item_identifier,
          itemDescription: r.item_description,
          quantityIssued: Number(r.qty_issued || 0)
        })),
        activityByDay,
        recentActivity: recentActivityRows.map((r) => ({
          type: r.type,
          id: r.event_id,
          occurredAt: r.occurred_at,
          itemIdentifier: r.item_identifier,
          itemDescription: r.item_description,
          quantity: Number(r.quantity || 0),
          employeeIdentifier: r.employee_identifier,
          employeeName: r.employee_name,
          supplierSource: r.supplier_source,
          referenceInvoiceNumber: r.reference_invoice_number,
          purposeProject: r.purpose_project
        }))
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
