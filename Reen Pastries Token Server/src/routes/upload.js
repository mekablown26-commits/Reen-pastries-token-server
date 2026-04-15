const router = require('express').Router();
const multer = require('multer');
const { requireOwnerAuth } = require('../middleware/auth');
const { uploadProductImage, uploadBannerImage } = require('../config/cloudinary');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'), false);
    }
    cb(null, true);
  },
});

// ── POST /api/upload/product-image ───────────
router.post('/product-image', requireOwnerAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No image provided' });
  try {
    const name = req.body.name || `product_${Date.now()}`;
    const { url, publicId } = await uploadProductImage(req.file.buffer, name);
    res.json({ success: true, url, publicId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Image upload failed' });
  }
});

// ── POST /api/upload/banner-image ─────────────
router.post('/banner-image', requireOwnerAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No image provided' });
  try {
    const name = req.body.name || `banner_${Date.now()}`;
    const { url, publicId } = await uploadBannerImage(req.file.buffer, name);
    res.json({ success: true, url, publicId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Banner upload failed' });
  }
});

module.exports = router;
