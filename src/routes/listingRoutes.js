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
} from '../controllers/listingController.js';
import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';

const router = express.Router();

router.get('/public', getPublicListings);

router.use(authMiddleware);

router.post('/favorite/:id', toggleFavorite);
router.get('/meta-data', getCategoriesAndTags);

router.use(authorizeRoles('creator'));

router.post('/add', upload.single('image'), createListing);
router.put('/update/:id', upload.single('image'), updateListing);
router.get('/my-listings', getMyListings);
router.delete('/delete/:id', deleteListing);

export default router;
