const cloudinary = require('cloudinary').v2;

const setupCloudinary = () => {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  console.log('✅ Cloudinary configured');
};

/**
 * Upload a product image to Cloudinary
 * @param {Buffer} fileBuffer
 * @param {string} productName
 * @returns {Promise<{url: string, publicId: string}>}
 */
const uploadProductImage = (fileBuffer, productName) => {
  return new Promise((resolve, reject) => {
    const sanitizedName = productName.toLowerCase().replace(/\s+/g, '_');
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'reen_pastries/products',
        public_id: `${sanitizedName}_${Date.now()}`,
        transformation: [
          { width: 800, height: 800, crop: 'fill', gravity: 'auto' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    uploadStream.end(fileBuffer);
  });
};

/**
 * Upload a banner/offer image
 */
const uploadBannerImage = (fileBuffer, name) => {
  return new Promise((resolve, reject) => {
    const sanitizedName = name.toLowerCase().replace(/\s+/g, '_');
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'reen_pastries/offers',
        public_id: `offer_${sanitizedName}_${Date.now()}`,
        transformation: [
          { width: 1200, height: 400, crop: 'fill' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    uploadStream.end(fileBuffer);
  });
};

/**
 * Delete an image from Cloudinary by public ID
 */
const deleteImage = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error('Cloudinary delete error:', err.message);
  }
};

module.exports = { setupCloudinary, uploadProductImage, uploadBannerImage, deleteImage };
