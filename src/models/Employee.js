const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  employeeIdentifier: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 64
  },
  employeeName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255
  },
  isActive: {
    type: Boolean,
    required: true,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Employee', employeeSchema);
