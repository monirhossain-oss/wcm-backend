import express from 'express';
import upload from '../config/multer.js';
import {
  registerUser,
  loginUser,
  becomeCreator,
  getMyProfile,
  logoutUser,
  updateUserProfile,
  updateCreatorProfile,
  deleteUserAccount,
  getPublicProfile,
  getFamousCreators,
} from '../controllers/userController.js';
import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.delete('/delete-account', authMiddleware, deleteUserAccount);

router.get('/famous-creators', getFamousCreators);
router.get('/me', authMiddleware, getMyProfile);
router.get('/profile/:id', getPublicProfile);

router.put(
  '/update-profile',
  authMiddleware,
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 },
  ]),
  updateUserProfile
);

router.put(
  '/update-creator-profile',
  authMiddleware,
  authorizeRoles('creator'),
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 },
  ]),
  updateCreatorProfile
);

router.post(
  '/become-creator',
  authMiddleware,
  authorizeRoles('user'),
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 },
  ]),
  becomeCreator
);

export default router;
