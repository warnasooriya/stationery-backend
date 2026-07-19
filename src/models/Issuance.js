const mongoose = require('mongoose');

const issuanceSchema = new mongoose.Schema({
  issuedAt: {
    type: Date,
    required: true
  },
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true
  },
  quantityIssued: {
    type: Number,
    required: true,
    min: 1
  },
  issuedTo: {
    type: String,
    required: true,
    trim: true,
    maxlength: 64
  },
  department: {
    type: String,
    default: '',
    trim: true
  },
  purposeProject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Issuance', issuanceSchema);
