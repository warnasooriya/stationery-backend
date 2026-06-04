async function listItemsWithStock(db) {
  const [rows] = await db.query(
    `
    SELECT
      i.id,
      i.item_identifier,
      i.item_description,
      i.min_safety_threshold,
      COALESCE(p.total_received, 0) AS total_received,
      COALESCE(s.total_issued, 0) AS total_issued,
      COALESCE(p.total_received, 0) - COALESCE(s.total_issued, 0) AS current_stock
    FROM items i
    LEFT JOIN (
      SELECT item_id, SUM(quantity_received) AS total_received
      FROM purchases_log
      GROUP BY item_id
    ) p ON p.item_id = i.id
    LEFT JOIN (
      SELECT item_id, SUM(quantity_issued) AS total_issued
      FROM issuance_log
      GROUP BY item_id
    ) s ON s.item_id = i.id
    WHERE i.is_active = 1
    ORDER BY i.item_identifier ASC
    `
  );

  return rows.map((r) => ({
    id: r.id,
    itemIdentifier: r.item_identifier,
    itemDescription: r.item_description,
    minSafetyThreshold: Number(r.min_safety_threshold),
    totalPurchased: Number(r.total_received),
    totalIssued: Number(r.total_issued),
    currentStock: Number(r.current_stock),
    stockStatus: Number(r.current_stock) <= Number(r.min_safety_threshold) ? 'LOW STOCK' : 'GOOD'
  }));
}

async function getItemCore(db, itemId) {
  const [rows] = await db.query(
    `
    SELECT id, item_identifier, item_description, min_safety_threshold, is_active
    FROM items
    WHERE id = ?
    `,
    [itemId]
  );
  return rows[0] || null;
}

async function getItemHistory(db, itemId) {
  const [purchases] = await db.query(
    `
    SELECT
      id,
      purchased_at AS occurred_at,
      quantity_received AS quantity,
      supplier_source,
      reference_invoice_number
    FROM purchases_log
    WHERE item_id = ?
    `,
    [itemId]
  );

  const [issuances] = await db.query(
    `
    SELECT
      s.id,
      issued_at AS occurred_at,
      quantity_issued AS quantity,
      s.issued_to,
      e.employee_name,
      s.purpose_project
    FROM issuance_log s
    LEFT JOIN employees e ON e.employee_identifier = s.issued_to AND e.is_active = 1
    WHERE s.item_id = ?
    `,
    [itemId]
  );

  const events = [
    ...purchases.map((p) => ({
      type: 'PURCHASE',
      id: p.id,
      occurredAt: p.occurred_at,
      qtyIn: Number(p.quantity),
      qtyOut: 0,
      supplierSource: p.supplier_source,
      referenceInvoiceNumber: p.reference_invoice_number,
      employeeIdentifier: null,
      employeeName: null,
      purposeProject: null
    })),
    ...issuances.map((s) => ({
      type: 'ISSUE',
      id: s.id,
      occurredAt: s.occurred_at,
      qtyIn: 0,
      qtyOut: Number(s.quantity),
      supplierSource: null,
      referenceInvoiceNumber: null,
      employeeIdentifier: s.issued_to,
      employeeName: s.employee_name || null,
      purposeProject: s.purpose_project
    }))
  ];

  events.sort((a, b) => {
    if (a.occurredAt === b.occurredAt) {
      if (a.type === b.type) return a.id - b.id;
      return a.type === 'PURCHASE' ? -1 : 1;
    }
    return a.occurredAt < b.occurredAt ? -1 : 1;
  });

  let running = 0;
  const ledger = events.map((e) => {
    running += e.qtyIn;
    running -= e.qtyOut;
    return { ...e, runningStock: running };
  });

  return ledger;
}

async function getCurrentStockForUpdate(connection, itemId) {
  const [rows] = await connection.query(
    `
    SELECT
      i.id,
      i.min_safety_threshold,
      (SELECT COALESCE(SUM(quantity_received), 0) FROM purchases_log WHERE item_id = i.id) AS total_received,
      (SELECT COALESCE(SUM(quantity_issued), 0) FROM issuance_log WHERE item_id = i.id) AS total_issued
    FROM items i
    WHERE i.id = ? AND i.is_active = 1
    FOR UPDATE
    `,
    [itemId]
  );

  const row = rows[0];
  if (!row) return null;
  const currentStock = Number(row.total_received) - Number(row.total_issued);

  return {
    itemId: row.id,
    minSafetyThreshold: Number(row.min_safety_threshold),
    totalPurchased: Number(row.total_received),
    totalIssued: Number(row.total_issued),
    currentStock
  };
}

module.exports = {
  listItemsWithStock,
  getItemCore,
  getItemHistory,
  getCurrentStockForUpdate
};
