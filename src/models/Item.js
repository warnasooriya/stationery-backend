const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  itemIdentifier: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 64
  },
  itemDescription: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255
  },
  minSafetyThreshold: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  isActive: {
    type: Boolean,
    required: true,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Item', itemSchema);
