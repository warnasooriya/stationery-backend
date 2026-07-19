require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { connectDB } = require('./db');
const User = require('./models/User');

const usersRouter = require('./routes/users');
const itemsRouter = require('./routes/items');
const purchasesRouter = require('./routes/purchases');
const issuancesRouter = require('./routes/issuances');
const employeesRouter = require('./routes/employees');
const exportRouter = require('./routes/export');
const dashboardRouter = require('./routes/dashboard');
const auth = require('./middleware/auth');

const app = express();

app.use(express.json({ limit: '1mb' }));

const frontendOrigin = process.env.FRONTEND_ORIGIN;
app.use(
  cors({
    origin: frontendOrigin ? [frontendOrigin] : true,
    credentials: false
  })
);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/users', usersRouter);

// Protect all other routes with auth middleware
app.use('/api/dashboard', auth, dashboardRouter);
app.use('/api/items', auth, itemsRouter);
app.use('/api/purchases', auth, purchasesRouter);
app.use('/api/issuances', auth, issuancesRouter);
app.use('/api/employees', auth, employeesRouter);
app.use('/api/export', auth, exportRouter);

app.use((err, _req, res, _next) => {
  const status = Number(err?.status || 500);
  const message = err?.message || 'Server error';

  if (err?.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation error',
      issues: err.issues?.map((i) => ({
        path: i.path?.join('.') || '',
        message: i.message
      }))
    });
  }

  res.status(status).json({ error: message });
});

async function seedAdminUser() {
  try {
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    
    const existingAdmin = await User.findOne({ username: adminUsername });
    if (existingAdmin) {
      console.log('Admin user already exists');
      return;
    }
    
    const admin = await User.create({
      username: adminUsername,
      password: adminPassword,
      isAdmin: true
    });
    
    console.log(`Default admin user created: ${adminUsername}`);
  } catch (err) {
    console.error('Error seeding admin user:', err);
  }
}

const port = Number(process.env.PORT || 4000);
async function startServer() {
  try {
    await connectDB();
    await seedAdminUser();
    app.listen(port, () => {
      process.stdout.write(`Backend listening on http://localhost:${port}\n`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
