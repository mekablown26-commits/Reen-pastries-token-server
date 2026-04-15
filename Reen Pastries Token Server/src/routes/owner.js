const router = require('express').Router();
const { requireOwnerAuth } = require('../middleware/auth');
const { getOrderStats } = require('../services/orderService');
const { prisma } = require('../config/database');

// ── GET /api/owner/dashboard ──────────────────
router.get('/dashboard', requireOwnerAuth, async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.setHours(0, 0, 0, 0));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayStats, monthStats, activeOrders, recentOrders, topProducts] = await Promise.all([
      getOrderStats(startOfToday, new Date()),
      getOrderStats(startOfMonth, new Date()),
      prisma.order.findMany({
        where: { status: { in: ['DEPOSIT_PAID', 'CONFIRMED', 'BAKING', 'READY'] } },
        include: {
          user: { select: { name: true, phone: true } },
          items: { include: { product: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.order.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { name: true } },
          items: { include: { product: { select: { name: true } } } },
        },
      }),
      prisma.product.findMany({
        orderBy: { totalSold: 'desc' },
        take: 5,
        select: { id: true, name: true, price: true, totalSold: true, imageUrl: true },
      }),
    ]);

    res.json({
      success: true,
      dashboard: {
        today: todayStats,
        thisMonth: monthStats,
        activeOrders,
        recentOrders,
        topProducts,
      },
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
});

// ── GET /api/owner/finances ───────────────────
router.get('/finances', requireOwnerAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const stats = await getOrderStats(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined
    );

    // Monthly breakdown
    const monthly = await prisma.$queryRaw`
      SELECT
        DATE_TRUNC('month', created_at) AS month,
        COUNT(*) FILTER (WHERE status = 'DELIVERED') AS completed_orders,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'DELIVERED'), 0) AS revenue,
        COALESCE(SUM(dev_share_amount) FILTER (WHERE status = 'DELIVERED'), 0) AS dev_share
      FROM orders
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC
      LIMIT 12
    `;

    res.json({
      success: true,
      finances: {
        summary: stats,
        monthly,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load finances' });
  }
});

// ── POST /api/owner/fcm-token ─────────────────
// Owner registers her device's FCM token for push notifications
router.post('/fcm-token', requireOwnerAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'FCM token required' });

  try {
    await prisma.devConfig.upsert({
      where: { key: 'OWNER_FCM_TOKEN' },
      update: { value: token },
      create: { key: 'OWNER_FCM_TOKEN', value: token, description: "Owner device FCM push token" },
    });
    res.json({ success: true, message: 'Push notifications enabled' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save FCM token' });
  }
});

// ── GET /api/owner/notifications ─────────────
router.get('/notifications', requireOwnerAuth, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { targetRole: { in: ['OWNER', 'ALL_CUSTOMERS'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, notifications });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
});

// ── PATCH /api/owner/notifications/:id/read ───
router.patch('/notifications/:id/read', requireOwnerAuth, async (req, res) => {
  try {
    await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
});

module.exports = router;
