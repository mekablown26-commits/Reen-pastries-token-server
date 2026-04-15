const router = require('express').Router();
const { body, param, query, validationResult } = require('express-validator');
const multer = require('multer');
const { requireOwnerAuth } = require('../middleware/auth');
const { uploadProductImage, deleteImage } = require('../config/cloudinary');
const { prisma } = require('../config/database');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── GET /api/products — public, customer app ──
router.get('/', [
  query('categoryId').optional().isUUID(),
  query('search').optional().isString(),
  query('onOffer').optional().isBoolean(),
], async (req, res) => {
  try {
    const { categoryId, search, onOffer } = req.query;

    const products = await prisma.product.findMany({
      where: {
        isAvailable: true,
        ...(categoryId && { categoryId }),
        ...(onOffer === 'true' && { isOnOffer: true }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

// ── GET /api/products/:id ─────────────────────
router.get('/:id', param('id').isUUID(), async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        category: true,
        reviews: { include: { user: { select: { name: true, photoUrl: true } } }, take: 10 },
      },
    });

    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch product' });
  }
});

// ── POST /api/products — owner only ───────────
router.post('/', requireOwnerAuth, upload.single('image'), [
  body('name').notEmpty().trim(),
  body('description').notEmpty().trim(),
  body('price').isFloat({ min: 0.01 }),
  body('categoryId').isUUID(),
  body('preparationTime').optional().isInt({ min: 1 }),
  body('stockCount').optional().isInt({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  if (!req.file) return res.status(400).json({ success: false, message: 'Product image is required' });

  try {
    const { name, description, price, categoryId, preparationTime, stockCount } = req.body;
    const { url, publicId } = await uploadProductImage(req.file.buffer, name);

    const product = await prisma.product.create({
      data: {
        name,
        description,
        price: parseFloat(price),
        imageUrl: url,
        imagePublicId: publicId,
        categoryId,
        preparationTime: preparationTime ? parseInt(preparationTime) : 60,
        stockCount: stockCount ? parseInt(stockCount) : null,
      },
      include: { category: true },
    });

    res.status(201).json({ success: true, message: 'Product created', product });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ success: false, message: 'Failed to create product' });
  }
});

// ── PATCH /api/products/:id — owner only ──────
router.patch('/:id', requireOwnerAuth, upload.single('image'), [
  param('id').isUUID(),
  body('price').optional().isFloat({ min: 0 }),
  body('isAvailable').optional().isBoolean(),
  body('isOnOffer').optional().isBoolean(),
  body('offerPrice').optional().isFloat({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Product not found' });

    let imageData = {};
    if (req.file) {
      // Delete old image from Cloudinary
      await deleteImage(existing.imagePublicId);
      const { url, publicId } = await uploadProductImage(req.file.buffer, req.body.name || existing.name);
      imageData = { imageUrl: url, imagePublicId: publicId };
    }

    const { name, description, price, categoryId, preparationTime, stockCount, isAvailable, isOnOffer, offerPrice } = req.body;

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(description && { description }),
        ...(price !== undefined && { price: parseFloat(price) }),
        ...(categoryId && { categoryId }),
        ...(preparationTime !== undefined && { preparationTime: parseInt(preparationTime) }),
        ...(stockCount !== undefined && { stockCount: stockCount === '' ? null : parseInt(stockCount) }),
        ...(isAvailable !== undefined && { isAvailable: isAvailable === 'true' || isAvailable === true }),
        ...(isOnOffer !== undefined && { isOnOffer: isOnOffer === 'true' || isOnOffer === true }),
        ...(offerPrice !== undefined && { offerPrice: parseFloat(offerPrice) }),
        ...imageData,
      },
      include: { category: true },
    });

    res.json({ success: true, message: 'Product updated', product });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update product' });
  }
});

// ── DELETE /api/products/:id — owner only ─────
router.delete('/:id', requireOwnerAuth, param('id').isUUID(), async (req, res) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    // Soft delete — just mark unavailable
    await prisma.product.update({
      where: { id: req.params.id },
      data: { isAvailable: false },
    });

    res.json({ success: true, message: 'Product removed from listing' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete product' });
  }
});

module.exports = router;
