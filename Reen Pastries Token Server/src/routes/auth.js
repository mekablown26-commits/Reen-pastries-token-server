const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { verifyFirebaseToken } = require('../config/firebase');
const { prisma } = require('../config/database');

// ── Customer: Register / Login with Firebase ──
// The customer app sends the Firebase ID token here
// We create the user in our DB if they don't exist
router.post('/customer/sync', [
  body('idToken').notEmpty().withMessage('Firebase ID token is required'),
  body('name').optional().isString(),
  body('phone').optional().isMobilePhone(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { idToken, phone } = req.body;
    const decoded = await verifyFirebaseToken(idToken);

    // Upsert user — create on first login, update on subsequent
    const user = await prisma.user.upsert({
      where: { firebaseUid: decoded.uid },
      update: {
        name: decoded.name || 'Customer',
        photoUrl: decoded.picture || null,
        ...(phone && { phone }),
      },
      create: {
        firebaseUid: decoded.uid,
        email: decoded.email,
        name: decoded.name || 'Customer',
        photoUrl: decoded.picture || null,
        phone: phone || null,
      },
    });

    res.json({
      success: true,
      message: 'Authenticated',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        photoUrl: user.photoUrl,
      },
    });
  } catch (err) {
    console.error('Customer sync error:', err.message);
    res.status(401).json({ success: false, message: 'Authentication failed' });
  }
});

// ── Customer: Update phone number ─────────────
router.patch('/customer/phone', [
  body('idToken').notEmpty(),
  body('phone').isMobilePhone().withMessage('Valid phone number required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { idToken, phone } = req.body;
    const decoded = await verifyFirebaseToken(idToken);

    const user = await prisma.user.update({
      where: { firebaseUid: decoded.uid },
      data: { phone },
    });

    res.json({ success: true, message: 'Phone updated', user: { phone: user.phone } });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Update failed' });
  }
});

// ── Owner Auth ────────────────────────────────
// Called once on setup; management app stores the JWT securely
router.post('/owner/login', [
  body('password').notEmpty(),
], async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.OWNER_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { role: 'owner', name: 'Reen Pastries Owner' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );

  res.json({ success: true, token, expiresIn: '30d' });
});

// ── Developer Auth ────────────────────────────
// Your personal console login
router.post('/dev/login', [
  body('password').notEmpty(),
], async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.DEV_CONSOLE_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { role: 'developer', name: 'Developer' },
    process.env.DEV_JWT_SECRET,
    { expiresIn: process.env.DEV_JWT_EXPIRES_IN || '30d' }
  );

  res.json({ success: true, token, expiresIn: '30d' });
});

module.exports = router;
