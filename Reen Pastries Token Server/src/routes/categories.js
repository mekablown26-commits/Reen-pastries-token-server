const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { requireOwnerAuth } = require('../middleware/auth');
const { prisma } = require('../config/database');

router.get('/', async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { products: { where: { isAvailable: true } } } } },
    });
    res.json({ success: true, categories });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
});

router.post('/', requireOwnerAuth, [
  body('name').notEmpty().trim(),
  body('description').optional().isString(),
  body('sortOrder').optional().isInt({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const category = await prisma.category.create({
      data: {
        name: req.body.name,
        description: req.body.description || null,
        sortOrder: req.body.sortOrder ? parseInt(req.body.sortOrder) : 0,
      },
    });
    res.status(201).json({ success: true, category });
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ success: false, message: 'Category already exists' });
    res.status(500).json({ success: false, message: 'Failed to create category' });
  }
});

router.patch('/:id', requireOwnerAuth, async (req, res) => {
  try {
    const category = await prisma.category.update({
      where: { id: req.params.id },
      data: {
        ...(req.body.name && { name: req.body.name }),
        ...(req.body.description !== undefined && { description: req.body.description }),
        ...(req.body.isActive !== undefined && { isActive: req.body.isActive }),
        ...(req.body.sortOrder !== undefined && { sortOrder: parseInt(req.body.sortOrder) }),
      },
    });
    res.json({ success: true, category });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update category' });
  }
});

module.exports = router;
