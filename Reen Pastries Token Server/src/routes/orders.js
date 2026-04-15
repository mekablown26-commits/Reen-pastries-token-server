const router = require('express').Router();
const { body, param, validationResult } = require('express-validator');
const { requireCustomerAuth, requireOwnerAuth } = require('../middleware/auth');
const { createOrder, cancelOrder, isCancelable } = require('../services/orderService');
const { prisma } = require('../config/database');

// ── POST /api/orders — customer places order ──
router.post('/', requireCustomerAuth, [
  body('items').isArray({ min: 1 }).withMessage('At least one item required'),
  body('items.*.productId').isUUID(),
  body('items.*.quantity').isInt({ min: 1 }),
  body('deliveryAddress').optional().isString(),
  body('deliveryNotes').optional().isString(),
  body('offerId').optional().isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const order = await createOrder({
      userId: req.user.id,
      items: req.body.items,
      deliveryAddress: req.body.deliveryAddress,
      deliveryNotes: req.body.deliveryNotes,
      offerId: req.body.offerId,
    });

    res.status(201).json({
      success: true,
      message: 'Order placed. Please pay the 50% deposit to confirm.',
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        depositAmount: order.depositAmount,
        totalAmount: order.totalAmount,
        cancelDeadline: order.cancelDeadline,
        isCancelable: true,
        items: order.items,
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── GET /api/orders/my — customer order history ──
router.get('/my', requireCustomerAuth, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: {
        items: { include: { product: { select: { name: true, imageUrl: true } } } },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const ordersWithCancelFlag = orders.map(o => ({
      ...o,
      isCancelable: isCancelable(o),
    }));

    res.json({ success: true, orders: ordersWithCancelFlag });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// ── GET /api/orders/:id ───────────────────────
router.get('/:id', requireCustomerAuth, param('id').isUUID(), async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        items: { include: { product: true } },
        payments: true,
      },
    });

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.userId !== req.user.id) return res.status(403).json({ success: false, message: 'Access denied' });

    res.json({ success: true, order: { ...order, isCancelable: isCancelable(order) } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
});

// ── POST /api/orders/:id/cancel ───────────────
router.post('/:id/cancel', requireCustomerAuth, [
  param('id').isUUID(),
  body('reason').optional().isString(),
], async (req, res) => {
  try {
    const { order, needsRefund } = await cancelOrder(
      req.params.id,
      req.user.id,
      req.body.reason
    );

    res.json({
      success: true,
      message: needsRefund
        ? 'Order cancelled. Your deposit will be refunded within 24 hours.'
        : 'Order cancelled successfully.',
      order,
      needsRefund,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── GET /api/orders — all orders (owner) ──────
router.get('/', requireOwnerAuth, async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const orders = await prisma.order.findMany({
      where: { ...(status && { status }) },
      include: {
        user: { select: { name: true, email: true, phone: true } },
        items: { include: { product: { select: { name: true } } } },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
    });

    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// ── PATCH /api/orders/:id/status — owner updates status ──
router.patch('/:id/status', requireOwnerAuth, [
  param('id').isUUID(),
  body('status').isIn(['CONFIRMED', 'BAKING', 'READY', 'DELIVERED']),
  body('estimatedReadyAt').optional().isISO8601(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { status, estimatedReadyAt } = req.body;
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        status,
        ...(estimatedReadyAt && { estimatedReadyAt: new Date(estimatedReadyAt) }),
        ...(status === 'DELIVERED' && { finalPaid: true, finalPaidAt: new Date() }),
      },
      include: { user: true },
    });

    // Map status to friendly customer message
    const statusMessages = {
      CONFIRMED: `Your order ${order.orderNumber} is confirmed! Reen has started preparations. 🎂`,
      BAKING: `Your order ${order.orderNumber} is now being baked! 🔥`,
      READY: `Your order ${order.orderNumber} is ready! 🎉`,
      DELIVERED: `Thank you for your order ${order.orderNumber}! Enjoy! 💕`,
    };

    res.json({ success: true, message: 'Status updated', order });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
});

module.exports = router;
