// import multer from 'multer';
// import path from 'path';
// import fs from 'fs';
// import crypto from 'crypto';

// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     const uploadPath = path.join(process.cwd(), 'uploads/listings');
//     if (!fs.existsSync(uploadPath)) {
//       fs.mkdirSync(uploadPath, { recursive: true });
//     }
//     cb(null, uploadPath);
//   },
//   filename: (req, file, cb) => {
//     const randomName = crypto.randomBytes(16).toString('hex');
//     const extension = path.extname(file.originalname);
//     cb(null, `${randomName}${extension}`);
//   },
// });

// const upload = multer({
//   storage,
//   limits: { fileSize: 5 * 1024 * 1024 },
//   fileFilter: (req, file, cb) => {
//     if (file.mimetype.startsWith('image/')) cb(null, true);
//     else cb(new Error('Only images are allowed!'), false);
//   },
// });

// export default upload;

import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'listings',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    transformation: [{ width: 1200, height: 800, crop: 'limit' }],
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

export default upload;
