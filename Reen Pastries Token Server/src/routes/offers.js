const router = require('express').Router();
const { body, param, validationResult } = require('express-validator');
const multer = require('multer');
const { requireOwnerAuth } = require('../middleware/auth');
const { uploadBannerImage, deleteImage } = require('../config/cloudinary');
const { prisma } = require('../config/database');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── GET /api/offers — active offers (public) ──
router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const offers = await prisma.offer.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, offers });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch offers' });
  }
});

// ── GET /api/offers/all — all offers (owner) ──
router.get('/all', requireOwnerAuth, async (req, res) => {
  try {
    const offers = await prisma.offer.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, offers });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch offers' });
  }
});

// ── POST /api/offers — owner creates offer ────
router.post('/', requireOwnerAuth, upload.single('banner'), [
  body('title').notEmpty().trim(),
  body('discountType').isIn(['PERCENTAGE', 'FLAT_AMOUNT', 'FREE_DELIVERY']),
  body('discountValue').isFloat({ min: 0 }),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('minOrderAmount').optional().isFloat({ min: 0 }),
  body('maxUsage').optional().isInt({ min: 1 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { title, description, discountType, discountValue, startDate, endDate, minOrderAmount, maxUsage } = req.body;

    let bannerData = {};
    if (req.file) {
      const { url } = await uploadBannerImage(req.file.buffer, title);
      bannerData = { bannerImageUrl: url };
    }

    const offer = await prisma.offer.create({
      data: {
        title,
        description: description || null,
        discountType,
        discountValue: parseFloat(discountValue),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        minOrderAmount: minOrderAmount ? parseFloat(minOrderAmount) : null,
        maxUsage: maxUsage ? parseInt(maxUsage) : null,
        ...bannerData,
      },
    });

    res.status(201).json({ success: true, message: 'Offer created', offer });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create offer' });
  }
});

// ── PATCH /api/offers/:id — owner updates offer ──
router.patch('/:id', requireOwnerAuth, param('id').isUUID(), upload.single('banner'), async (req, res) => {
  try {
    const { title, description, isActive, discountValue, startDate, endDate, minOrderAmount } = req.body;

    let bannerData = {};
    if (req.file) {
      const { url } = await uploadBannerImage(req.file.buffer, title || 'offer');
      bannerData = { bannerImageUrl: url };
    }

    const offer = await prisma.offer.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive: isActive === 'true' || isActive === true }),
        ...(discountValue !== undefined && { discountValue: parseFloat(discountValue) }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
        ...(minOrderAmount !== undefined && { minOrderAmount: parseFloat(minOrderAmount) }),
        ...bannerData,
      },
    });

    res.json({ success: true, message: 'Offer updated', offer });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update offer' });
  }
});

// ── DELETE /api/offers/:id ────────────────────
router.delete('/:id', requireOwnerAuth, param('id').isUUID(), async (req, res) => {
  try {
    await prisma.offer.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, message: 'Offer deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to deactivate offer' });
  }
});

module.exports = router;
