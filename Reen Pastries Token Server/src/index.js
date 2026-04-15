require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const { prisma } = require('./config/database');
const { initFirebase } = require('./config/firebase');
const { setupCloudinary } = require('./config/cloudinary');
const { expireOldOrders } = require('./services/orderService');

// Route imports
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const categoryRoutes = require('./routes/categories');
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payments');
const offerRoutes = require('./routes/offers');
const devRoutes = require('./routes/dev');
const ownerRoutes = require('./routes/owner');
const uploadRoutes = require('./routes/upload');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Initialise external services ─────────────
initFirebase();
setupCloudinary();

// ── Security middleware ───────────────────────
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    const allowed = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];
    if (allowed.includes('*') || !origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many auth attempts, please try again later.' },
});

app.use(globalLimiter);

// ── Body parsing ──────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── Health check ──────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      success: true,
      status: 'healthy',
      app: 'Reen Pastries Token Server',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      database: 'connected',
    });
  } catch (err) {
    res.status(503).json({ success: false, status: 'unhealthy', database: 'disconnected' });
  }
});

// ── API Routes ────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/owner', ownerRoutes);       // Owner management panel
app.use('/api/dev', devRoutes);           // Developer console (your private routes)

// ── 404 handler ───────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ── Global error handler ──────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'An internal error occurred'
      : err.message,
  });
});

// ── Cron Jobs ─────────────────────────────────
// Every minute: check for orders past their cancel deadline and lock them
cron.schedule('* * * * *', async () => {
  try {
    await expireOldOrders();
  } catch (err) {
    console.error('Cron job error:', err.message);
  }
});

// ── Start server ──────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║      Reen Pastries Token Server           ║
  ║      Running on port ${PORT}                ║
  ║      Environment: ${process.env.NODE_ENV || 'development'}           ║
  ╚═══════════════════════════════════════════╝
  `);
});

module.exports = app;
