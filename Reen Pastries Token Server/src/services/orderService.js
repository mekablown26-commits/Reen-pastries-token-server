const { prisma } = require('../config/database');
const { sendPushNotification } = require('../config/firebase');

/**
 * Generate a human-readable order number like RP-2024-00042
 */
const generateOrderNumber = async () => {
  const year = new Date().getFullYear();
  const count = await prisma.order.count();
  const padded = String(count + 1).padStart(5, '0');
  return `RP-${year}-${padded}`;
};

/**
 * Calculate the developer revenue share for an order
 */
const calculateDevShare = async (totalAmount) => {
  // Read current dev share rate from DevConfig, fallback to env var
  let rate;
  try {
    const config = await prisma.devConfig.findUnique({ where: { key: 'DEV_REVENUE_SHARE_PERCENT' } });
    rate = config ? parseFloat(config.value) : parseFloat(process.env.DEV_REVENUE_SHARE_PERCENT || '5');
  } catch {
    rate = parseFloat(process.env.DEV_REVENUE_SHARE_PERCENT || '5');
  }
  return {
    devShareAmount: parseFloat(((totalAmount * rate) / 100).toFixed(2)),
    devShareRate: rate,
  };
};

/**
 * Create a new order with 30-minute cancel window and 50% deposit
 */
const createOrder = async ({ userId, items, deliveryAddress, deliveryNotes, offerId }) => {
  // Fetch products and validate
  const productIds = items.map(i => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isAvailable: true },
  });

  if (products.length !== items.length) {
    throw new Error('One or more products are unavailable');
  }

  // Build order items with price snapshot
  let subtotal = 0;
  const orderItems = items.map(item => {
    const product = products.find(p => p.id === item.productId);
    const unitPrice = product.isOnOffer && product.offerPrice ? product.offerPrice : product.price;
    const totalPrice = unitPrice * item.quantity;
    subtotal += totalPrice;
    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice,
      totalPrice,
      notes: item.notes || null,
    };
  });

  // Apply offer/discount if applicable
  let discountAmount = 0;
  if (offerId) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId, isActive: true } });
    if (offer && new Date() >= offer.startDate && new Date() <= offer.endDate) {
      if (!offer.minOrderAmount || subtotal >= offer.minOrderAmount) {
        if (offer.discountType === 'PERCENTAGE') {
          discountAmount = (subtotal * offer.discountValue) / 100;
        } else if (offer.discountType === 'FLAT_AMOUNT') {
          discountAmount = offer.discountValue;
        }
      }
    }
  }

  const deliveryFee = 0; // owner can configure this later
  const totalAmount = parseFloat((subtotal - discountAmount + deliveryFee).toFixed(2));
  const depositAmount = parseFloat((totalAmount * 0.5).toFixed(2)); // 50% deposit
  const remainingAmount = parseFloat((totalAmount - depositAmount).toFixed(2));

  // 30-minute cancellation window
  const cancelDeadline = new Date(Date.now() + 30 * 60 * 1000);

  const { devShareAmount, devShareRate } = await calculateDevShare(totalAmount);
  const orderNumber = await generateOrderNumber();

  const order = await prisma.order.create({
    data: {
      orderNumber,
      userId,
      subtotal,
      deliveryFee,
      discountAmount,
      totalAmount,
      depositAmount,
      remainingAmount,
      devShareAmount,
      devShareRate,
      cancelDeadline,
      deliveryAddress: deliveryAddress || null,
      deliveryNotes: deliveryNotes || null,
      offerId: offerId || null,
      items: { create: orderItems },
    },
    include: {
      items: { include: { product: true } },
      user: true,
    },
  });

  // Notify owner of new order
  await notifyOwner('New Order! 🎂', `Order ${orderNumber} — KES ${totalAmount}. Awaiting deposit.`, {
    orderId: order.id,
    screen: 'orders',
  });

  return order;
};

/**
 * Cancel an order — only allowed within the 30-minute window
 */
const cancelOrder = async (orderId, userId, reason) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: true },
  });

  if (!order) throw new Error('Order not found');
  if (order.userId !== userId) throw new Error('Not your order');
  if (order.status === 'CANCELLED') throw new Error('Order already cancelled');
  if (order.status === 'DELIVERED') throw new Error('Cannot cancel a delivered order');

  // Check if still within cancellation window
  if (new Date() > order.cancelDeadline) {
    throw new Error('Cancellation window has closed (30 minutes exceeded). Please contact the baker.');
  }

  // If deposit was already paid, flag for refund
  const needsRefund = order.depositPaid;

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: needsRefund ? 'REFUNDED' : 'CANCELLED',
      cancelledAt: new Date(),
      cancellationReason: reason || 'Cancelled by customer',
    },
  });

  await notifyOwner(
    `Order Cancelled ❌`,
    `Order ${order.orderNumber} was cancelled by customer.${needsRefund ? ' Deposit refund needed.' : ''}`,
    { orderId: order.id, screen: 'orders' }
  );

  return { order: updatedOrder, needsRefund };
};

/**
 * Check if an order is still within the cancel window
 */
const isCancelable = (order) => {
  return new Date() <= new Date(order.cancelDeadline) &&
    !['CANCELLED', 'DELIVERED', 'REFUNDED'].includes(order.status);
};

/**
 * Cron job: mark orders past cancel deadline as non-cancellable
 * (just an internal flag, status doesn't change from PENDING,
 * but the app reads cancelDeadline to hide the cancel button)
 */
const expireOldOrders = async () => {
  // Auto-cancel PENDING orders that never paid their deposit after 2 hours
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await prisma.order.updateMany({
    where: {
      status: 'PENDING',
      depositPaid: false,
      createdAt: { lt: twoHoursAgo },
    },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancellationReason: 'Auto-cancelled: deposit not received within 2 hours',
    },
  });
};

/**
 * Get order summary stats for a given period
 */
const getOrderStats = async (fromDate, toDate) => {
  const where = {
    createdAt: {
      gte: fromDate || new Date(0),
      lte: toDate || new Date(),
    },
  };

  const [totalOrders, completedOrders, cancelledOrders, revenueAgg, devShareAgg] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.count({ where: { ...where, status: 'DELIVERED' } }),
    prisma.order.count({ where: { ...where, status: { in: ['CANCELLED', 'REFUNDED'] } } }),
    prisma.order.aggregate({ where: { ...where, status: 'DELIVERED' }, _sum: { totalAmount: true } }),
    prisma.order.aggregate({ where: { ...where, status: 'DELIVERED' }, _sum: { devShareAmount: true } }),
  ]);

  const totalRevenue = revenueAgg._sum.totalAmount || 0;
  const totalDevShare = devShareAgg._sum.devShareAmount || 0;
  const ownerRevenue = totalRevenue - totalDevShare;

  return {
    totalOrders,
    completedOrders,
    cancelledOrders,
    totalRevenue,
    totalDevShare,
    ownerRevenue,
  };
};

/**
 * Notify the owner via FCM (reads owner FCM token from DevConfig)
 */
const notifyOwner = async (title, body, data = {}) => {
  try {
    const config = await prisma.devConfig.findUnique({ where: { key: 'OWNER_FCM_TOKEN' } });
    if (config?.value) {
      await sendPushNotification({ token: config.value, title, body, data });
    }
    // Also save as in-app notification
    await prisma.notification.create({
      data: { targetRole: 'OWNER', title, body, data: JSON.stringify(data) },
    });
  } catch (err) {
    console.error('Notify owner error:', err.message);
  }
};

module.exports = {
  createOrder,
  cancelOrder,
  isCancelable,
  expireOldOrders,
  getOrderStats,
  generateOrderNumber,
  calculateDevShare,
};
