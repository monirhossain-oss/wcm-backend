import express from 'express';
import upload from '../config/multer.js';
import {
  createListing,
  getMyListings,
  updateListing,
  deleteListing,
  getPublicListings,
  toggleFavorite,
  getCategoriesAndTags,
  getListingById,
  getCreatorListingCount,
  handlePpcClick,
  cancelPromotion,
} from '../controllers/listingController.js';
import { authMiddleware, authorizeRoles, optionalAuth } from '../middlewares/auth.js';

const router = express.Router();

router.get('/public', optionalAuth, getPublicListings);
router.get('/meta-data', getCategoriesAndTags);

router.get('/count/:creatorId', getCreatorListingCount);

router.post('/favorite/:id', authMiddleware, toggleFavorite);

router.post('/:id/click', handlePpcClick);

router.get('/my-listings', authMiddleware, authorizeRoles('creator'), getMyListings);
router.post(
  '/add',
  authMiddleware,
  authorizeRoles('creator'),
  upload.single('image'),
  createListing
);
router.put(
  '/update/:id',
  authMiddleware,
  authorizeRoles('creator'),
  upload.single('image'),
  updateListing
);
router.delete('/delete/:id', authMiddleware, authorizeRoles('creator'), deleteListing);

router.get('/:id', optionalAuth, getListingById);
router.patch('/:id/cancel-promotion', authMiddleware, cancelPromotion);

export default router;
