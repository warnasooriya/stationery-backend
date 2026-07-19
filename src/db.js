const mongoose = require('mongoose');

let connection;

async function connectDB() {
  if (connection) return connection;

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('Missing required env var: MONGO_URI');
  }

  connection = await mongoose.connect(mongoUri);
  
  process.stdout.write('MongoDB connected successfully\n');
  
  return connection;
}

function getConnection() {
  return connection;
}

module.exports = { connectDB, getConnection, mongoose };
