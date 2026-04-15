const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { requireDevAuth } = require('../middleware/auth');
const { getOrderStats } = require('../services/orderService');
const { prisma } = require('../config/database');

// ── GET /api/dev/overview ─────────────────────
// Your full system overview
router.get('/overview', requireDevAuth, async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.setHours(0, 0, 0, 0));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const [todayStats, monthStats, yearStats, allTimeStats, totalUsers, totalProducts] = await Promise.all([
      getOrderStats(startOfToday, new Date()),
      getOrderStats(startOfMonth, new Date()),
      getOrderStats(startOfYear, new Date()),
      getOrderStats(undefined, undefined),
      prisma.user.count(),
      prisma.product.count({ where: { isAvailable: true } }),
    ]);

    // Current dev share rate
    const rateConfig = await prisma.devConfig.findUnique({ where: { key: 'DEV_REVENUE_SHARE_PERCENT' } });
    const currentRate = rateConfig ? parseFloat(rateConfig.value) : parseFloat(process.env.DEV_REVENUE_SHARE_PERCENT || '5');

    res.json({
      success: true,
      overview: {
        currentRate,
        totalUsers,
        totalProducts,
        today: todayStats,
        thisMonth: monthStats,
        thisYear: yearStats,
        allTime: allTimeStats,
      },
    });
  } catch (err) {
    console.error('Dev overview error:', err);
    res.status(500).json({ success: false, message: 'Failed to load overview' });
  }
});

// ── GET /api/dev/revenue ──────────────────────
// Detailed revenue breakdown — your cut, her cut, everything
router.get('/revenue', requireDevAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const stats = await getOrderStats(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined
    );

    // Per-order breakdown (last 100 completed orders)
    const orders = await prisma.order.findMany({
      where: {
        status: 'DELIVERED',
        ...(from && { createdAt: { gte: new Date(from) } }),
        ...(to && { createdAt: { lte: new Date(to) } }),
      },
      select: {
        id: true,
        orderNumber: true,
        totalAmount: true,
        devShareAmount: true,
        devShareRate: true,
        createdAt: true,
        finalPaidAt: true,
        user: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Monthly trend
    const monthlyRevenue = await prisma.$queryRaw`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') AS month,
        COUNT(*) AS orders,
        COALESCE(SUM(total_amount), 0)::numeric(10,2) AS total_revenue,
        COALESCE(SUM(dev_share_amount), 0)::numeric(10,2) AS dev_earnings,
        COALESCE(SUM(total_amount - dev_share_amount), 0)::numeric(10,2) AS owner_earnings
      FROM orders
      WHERE status = 'DELIVERED'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at) DESC
      LIMIT 12
    `;

    res.json({
      success: true,
      revenue: {
        summary: stats,
        orders,
        monthlyTrend: monthlyRevenue,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load revenue data' });
  }
});

// ── GET /api/dev/users ────────────────────────
router.get('/users', requireDevAuth, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
        include: { _count: { select: { orders: true } } },
      }),
      prisma.user.count(),
    ]);
    res.json({ success: true, users, total });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// ── PATCH /api/dev/rate ───────────────────────
// Update your revenue share percentage
router.patch('/rate', requireDevAuth, [
  body('rate').isFloat({ min: 0, max: 100 }).withMessage('Rate must be between 0 and 100'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { rate } = req.body;
    await prisma.devConfig.upsert({
      where: { key: 'DEV_REVENUE_SHARE_PERCENT' },
      update: { value: String(rate) },
      create: {
        key: 'DEV_REVENUE_SHARE_PERCENT',
        value: String(rate),
        description: 'Developer revenue share percentage per completed order',
      },
    });
    res.json({ success: true, message: `Dev rate updated to ${rate}%`, rate });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update rate' });
  }
});

// ── GET /api/dev/config ───────────────────────
router.get('/config', requireDevAuth, async (req, res) => {
  try {
    const configs = await prisma.devConfig.findMany({ orderBy: { key: 'asc' } });
    // Mask sensitive values
    const safe = configs.map(c => ({
      ...c,
      value: c.key.includes('TOKEN') || c.key.includes('SECRET')
        ? '***HIDDEN***'
        : c.value,
    }));
    res.json({ success: true, configs: safe });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch config' });
  }
});

// ── PATCH /api/dev/config/:key ────────────────
router.patch('/config/:key', requireDevAuth, [
  body('value').notEmpty(),
], async (req, res) => {
  try {
    const config = await prisma.devConfig.upsert({
      where: { key: req.params.key },
      update: { value: req.body.value },
      create: { key: req.params.key, value: req.body.value, description: req.body.description || '' },
    });
    res.json({ success: true, message: 'Config updated', config });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update config' });
  }
});

// ── POST /api/dev/suspend-user ────────────────
router.post('/suspend-user', requireDevAuth, [
  body('userId').isUUID(),
  body('suspend').isBoolean(),
], async (req, res) => {
  try {
    const { userId, suspend } = req.body;
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: !suspend },
    });
    res.json({ success: true, message: `User ${suspend ? 'suspended' : 'reactivated'}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update user' });
  }
});

module.exports = router;
