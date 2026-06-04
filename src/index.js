require('dotenv').config();

const express = require('express');
const cors = require('cors');

const itemsRouter = require('./routes/items');
const purchasesRouter = require('./routes/purchases');
const issuancesRouter = require('./routes/issuances');
const employeesRouter = require('./routes/employees');
const exportRouter = require('./routes/export');
const dashboardRouter = require('./routes/dashboard');

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

app.use('/api/dashboard', dashboardRouter);
app.use('/api/items', itemsRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/issuances', issuancesRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/export', exportRouter);

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

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  process.stdout.write(`Backend listening on http://localhost:${port}\n`);
});
