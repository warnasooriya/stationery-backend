const XLSX = require('xlsx');

function makeWorkbook({ sheetName, rows }) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows, { skipHeader: false });
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return workbook;
}

function workbookToBuffer(workbook) {
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { makeWorkbook, workbookToBuffer };
