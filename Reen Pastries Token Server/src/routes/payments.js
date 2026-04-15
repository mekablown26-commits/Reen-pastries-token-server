const router = require('express').Router();
const { body, param, validationResult } = require('express-validator');
const { requireCustomerAuth } = require('../middleware/auth');
const { initiateSTKPush, queryStkStatus } = require('../services/mpesaService');
const { prisma } = require('../config/database');
const { sendPushNotification } = require('../config/firebase');

// ── POST /api/payments/mpesa/initiate ─────────
// Customer initiates MPesa STK Push for deposit
router.post('/mpesa/initiate', requireCustomerAuth, [
  body('orderId').isUUID(),
  body('phoneNumber').notEmpty().withMessage('Phone number required'),
  body('paymentType').isIn(['DEPOSIT', 'FINAL']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { orderId, phoneNumber, paymentType } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.userId !== req.user.id) return res.status(403).json({ success: false, message: 'Access denied' });

    if (paymentType === 'DEPOSIT' && order.depositPaid) {
      return res.status(400).json({ success: false, message: 'Deposit already paid' });
    }
    if (paymentType === 'FINAL' && !order.depositPaid) {
      return res.status(400).json({ success: false, message: 'Deposit must be paid first' });
    }

    const amount = paymentType === 'DEPOSIT' ? order.depositAmount : order.remainingAmount;

    const stkResponse = await initiateSTKPush({
      phoneNumber,
      amount,
      orderNumber: order.orderNumber,
      accountRef: `RP-${order.orderNumber}`,
    });

    if (stkResponse.ResponseCode !== '0') {
      return res.status(400).json({ success: false, message: stkResponse.ResponseDescription });
    }

    // Create a PENDING payment record
    await prisma.payment.create({
      data: {
        orderId,
        amount,
        method: 'MPESA',
        type: paymentType,
        status: 'PROCESSING',
        transactionRef: stkResponse.CheckoutRequestID,
        phoneNumber,
      },
    });

    res.json({
      success: true,
      message: 'STK Push sent. Enter your MPesa PIN to complete payment.',
      checkoutRequestId: stkResponse.CheckoutRequestID,
    });
  } catch (err) {
    console.error('MPesa initiate error:', err);
    res.status(500).json({ success: false, message: 'Payment initiation failed. Please try again.' });
  }
});

// ── POST /api/payments/mpesa/callback ─────────
// Safaricom calls this after customer completes/cancels payment
// MUST be publicly accessible — no auth middleware
router.post('/mpesa/callback', async (req, res) => {
  // Always respond 200 to Safaricom immediately
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const { Body } = req.body;
    const { stkCallback } = Body;
    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

    const payment = await prisma.payment.findFirst({
      where: { transactionRef: CheckoutRequestID },
      include: { order: { include: { user: true } } },
    });

    if (!payment) return;

    if (ResultCode === 0) {
      // Payment SUCCESS
      const meta = {};
      CallbackMetadata?.Item?.forEach(item => { meta[item.Name] = item.Value; });

      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          mpesaReceiptNo: meta.MpesaReceiptNumber || null,
          rawResponse: JSON.stringify(stkCallback),
        },
      });

      // Update order
      const isDeposit = payment.type === 'DEPOSIT';
      await prisma.order.update({
        where: { id: payment.orderId },
        data: {
          ...(isDeposit && {
            depositPaid: true,
            depositPaidAt: new Date(),
            depositTxRef: meta.MpesaReceiptNumber,
            status: 'DEPOSIT_PAID',
          }),
          ...(!isDeposit && {
            finalPaid: true,
            finalPaidAt: new Date(),
            finalTxRef: meta.MpesaReceiptNumber,
            status: 'DELIVERED',
          }),
        },
      });

      // Notify customer
      // (FCM token stored per user — for now, log it)
      console.log(`✅ Payment success for order ${payment.order.orderNumber}: ${meta.MpesaReceiptNumber}`);

      // Notify owner of confirmed deposit
      if (isDeposit) {
        const ownerConfig = await prisma.devConfig.findUnique({ where: { key: 'OWNER_FCM_TOKEN' } });
        if (ownerConfig?.value) {
          await sendPushNotification({
            token: ownerConfig.value,
            title: 'Deposit Received! 💰',
            body: `Order ${payment.order.orderNumber} — KES ${payment.amount} deposit confirmed. Start baking!`,
            data: { orderId: payment.orderId, screen: 'orders' },
          });
        }
        await prisma.notification.create({
          data: {
            targetRole: 'OWNER',
            title: 'Deposit Received! 💰',
            body: `Order ${payment.order.orderNumber} — KES ${payment.amount} deposit confirmed.`,
            data: JSON.stringify({ orderId: payment.orderId }),
          },
        });
      }
    } else {
      // Payment FAILED
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', rawResponse: JSON.stringify(stkCallback) },
      });
      console.log(`❌ Payment failed for order ${payment.order.orderNumber}: ${ResultDesc}`);
    }
  } catch (err) {
    console.error('MPesa callback processing error:', err.message);
  }
});

// ── GET /api/payments/mpesa/status/:checkoutId ──
// Poll payment status
router.get('/mpesa/status/:checkoutId', requireCustomerAuth, async (req, res) => {
  try {
    const payment = await prisma.payment.findFirst({
      where: { transactionRef: req.params.checkoutId },
    });

    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    res.json({
      success: true,
      status: payment.status,
      receiptNo: payment.mpesaReceiptNo,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to check payment status' });
  }
});

// ── POST /api/payments/google-pay/verify ──────
// Server-side Google Pay token verification
router.post('/google-pay/verify', requireCustomerAuth, [
  body('orderId').isUUID(),
  body('paymentToken').notEmpty(),
  body('paymentType').isIn(['DEPOSIT', 'FINAL']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { orderId, paymentToken, paymentType } = req.body;
    const order = await prisma.order.findUnique({ where: { id: orderId } });

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.userId !== req.user.id) return res.status(403).json({ success: false, message: 'Access denied' });

    const amount = paymentType === 'DEPOSIT' ? order.depositAmount : order.remainingAmount;

    // In production, verify paymentToken with Google Pay servers
    // For now, we trust the token and process locally
    // TODO: integrate with your payment processor (Stripe, Flutterwave, etc.)

    const txRef = `GP-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    await prisma.payment.create({
      data: {
        orderId,
        amount,
        method: 'GOOGLE_PAY',
        type: paymentType,
        status: 'SUCCESS',
        transactionRef: txRef,
      },
    });

    const isDeposit = paymentType === 'DEPOSIT';
    await prisma.order.update({
      where: { id: orderId },
      data: {
        ...(isDeposit && { depositPaid: true, depositPaidAt: new Date(), depositTxRef: txRef, status: 'DEPOSIT_PAID' }),
        ...(!isDeposit && { finalPaid: true, finalPaidAt: new Date(), finalTxRef: txRef, status: 'DELIVERED' }),
      },
    });

    res.json({ success: true, message: 'Payment processed', transactionRef: txRef });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Google Pay verification failed' });
  }
});

module.exports = router;
