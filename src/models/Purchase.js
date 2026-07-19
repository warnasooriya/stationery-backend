const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  purchasedAt: {
    type: Date,
    required: true
  },
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true
  },
  quantityReceived: {
    type: Number,
    required: true,
    min: 1
  },
  supplierSource: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255
  },
  referenceInvoiceNumber: {
    type: String,
    required: true,
    trim: true,
    maxlength: 128
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Purchase', purchaseSchema);
