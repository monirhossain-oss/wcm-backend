import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// ১. Register
export const registerUser = async (req, res) => {
  try {
    const { firstName, lastName, username, email, password } = req.body;
    const userExists = await User.findOne({ $or: [{ email }, { username }] });
    if (userExists) return res.status(400).json({ message: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      firstName,
      lastName,
      username,
      email,
      password: hashedPassword,
      profile: {},
    });
    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ২. Login
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (user.status === 'blocked') {
      return res.status(403).json({
        message: 'Your account has been blocked by admin. Please contact support.',
      });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user._id,
        username: user.username,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 3. Become Creator (Request)
export const becomeCreator = async (req, res) => {
  try {
    const { displayName, bio, country, city, language, websiteLink, socialLink } = req.body;

    // ✅ ১. ডাটাবেজ থেকে বর্তমান ইউজারকে খুঁজে বের করুন (req.user এর ওপর নির্ভর করবেন না)
    const currentUser = await User.findById(req.user._id);

    // বর্তমান ইমেজগুলো ব্যাকআপ হিসেবে রাখা হচ্ছে
    let profilePath = currentUser.profile?.profileImage || '';
    let coverPath = currentUser.profile?.coverImage || '';

    // ✅ ২. নতুন ফাইল আপলোড হলে তবেই পাথ আপডেট হবে
    if (req.files) {
      if (req.files.profileImage?.[0]) {
        profilePath = req.files.profileImage[0].path; // Cloudinary URL
      }
      if (req.files.coverImage?.[0]) {
        coverPath = req.files.coverImage[0].path; // Cloudinary URL
      }
    }

    // ৩. ডাটাবেজ আপডেট
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          'profile.displayName': displayName,
          'profile.bio': bio,
          'profile.country': country,
          'profile.city': city,
          'profile.language': language,
          'profile.websiteLink': websiteLink,
          'profile.socialLink': socialLink,
          'profile.profileImage': profilePath, // আপডেট হওয়া পাথ
          'profile.coverImage': coverPath, // আপডেট হওয়া পাথ

          'creatorRequest.isApplied': true,
          'creatorRequest.appliedAt': new Date(),
          'creatorRequest.status': 'pending',
          'creatorRequest.rejectionReason': '',
        },
      },
      { new: true, runValidators: true } // new: true নিশ্চিত করে যে আপডেট হওয়া ডাটা রিটার্ন করবে
    ).select('-password');

    res.status(200).json({
      message: 'Creator request submitted successfully',
      user: updatedUser,
    });
  } catch (error) {
    console.error('Become Creator Error:', error);
    res.status(500).json({ message: error.message });
  }
};

// ৪. Profile View
export const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ৫. Logout
export const logoutUser = (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
  });
  res.status(200).json({ message: 'Logged out successfully' });
};

// ৬. (user update)
export const updateUserProfile = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      displayName,
      bio,
      country,
      city,
      language,
      websiteLink,
      socialLink,
    } = req.body;

    const currentUser = await User.findById(req.user._id);

    let profilePath = currentUser.profile?.profileImage;
    let coverPath = currentUser.profile?.coverImage;

    if (req.files) {
      if (req.files['profileImage']) {
        profilePath = req.files['profileImage'][0].path;
      }
      if (req.files['coverImage']) {
        coverPath = req.files['coverImage'][0].path;
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          firstName,
          lastName,
          'profile.displayName': displayName,
          'profile.bio': bio,
          'profile.country': country,
          'profile.city': city,
          'profile.language': language,
          'profile.websiteLink': websiteLink,
          'profile.socialLink': socialLink,
          'profile.profileImage': profilePath,
          'profile.coverImage': coverPath,
        },
      },
      { returnDocument: 'after' }
    ).select('-password');

    res.status(200).json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Profile Update Error:', error);
    res.status(500).json({ message: error.message });
  }
};

// ৭. (creator update)
export const updateCreatorProfile = async (req, res) => {
  try {
    if (req.user.role !== 'creator') {
      return res
        .status(403)
        .json({ message: 'Access denied. Only creators can update these fields.' });
    }

    const { displayName, bio, country, city, language, websiteLink, socialLink } = req.body;

    const updateFields = {
      'profile.displayName': displayName,
      'profile.bio': bio,
      'profile.country': country,
      'profile.city': city,
      'profile.language': language,
      'profile.websiteLink': websiteLink,
      'profile.socialLink': socialLink,
    };

    if (req.files) {
      if (req.files.profileImage) {
        updateFields['profile.profileImage'] = req.files.profileImage[0].path;
      }
      if (req.files.coverImage) {
        updateFields['profile.coverImage'] = req.files.coverImage[0].path;
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updateFields },
      { new: true }
    ).select('-password');

    res.status(200).json({ message: 'Creator profile updated', user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
