import Listing from '../models/Listing.js';
import fs from 'fs';
import path from 'path';
import Category from '../models/Category.js';
import Tag from '../models/Tag.js';

export const getCategoriesAndTags = async (req, res) => {
  try {
    const categories = await Category.find().sort({ title: 1 });
    const tags = await Tag.find().sort({ title: 1 });
    res.status(200).json({ categories, tags });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createListing = async (req, res) => {
  try {
    const {
      title,
      description,
      externalUrls,
      websiteLink,
      region,
      country,
      tradition,
      category,
      culturalTags,
    } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'Please upload an image' });
    }

    const imageUrl = `/uploads/listings/${req.file.filename}`;

    let urlList = [];
    if (externalUrls) {
      urlList = Array.isArray(externalUrls)
        ? externalUrls
        : externalUrls
            .split(',')
            .map((url) => url.trim())
            .filter((url) => url !== '');
    }

    let tagIds = [];
    if (culturalTags) {
      tagIds = Array.isArray(culturalTags)
        ? culturalTags
        : culturalTags
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t !== '');
    }

    const newListing = await Listing.create({
      creatorId: req.user._id,
      title,
      description,
      externalUrls: urlList,
      websiteLink,
      region,
      country,
      tradition,
      category,
      culturalTags: tagIds,
      image: imageUrl,
    });

    res.status(201).json({ message: 'Listing created successfully', newListing });
  } catch (error) {
    if (req.file) {
      const uploadedPath = path.join(process.cwd(), 'uploads/listings', req.file.filename);
      if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
    }
    res.status(500).json({ message: error.message });
  }
};

export const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const listing = await Listing.findById(id);

    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    if (listing.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized to update' });
    }

    let updateData = { ...req.body };

    updateData.status = 'pending';
    updateData.rejectionReason = '';

    if (updateData.externalUrls) {
      updateData.externalUrls = Array.isArray(updateData.externalUrls)
        ? updateData.externalUrls
        : updateData.externalUrls
            .split(',')
            .map((url) => url.trim())
            .filter((url) => url !== '');
    }

    if (updateData.culturalTags) {
      updateData.culturalTags = Array.isArray(updateData.culturalTags)
        ? updateData.culturalTags
        : updateData.culturalTags
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t !== '');
    }

    if (req.file) {
      const oldImagePath = path.join(process.cwd(), listing.image);
      if (fs.existsSync(oldImagePath)) {
        try {
          fs.unlinkSync(oldImagePath);
        } catch (err) {
          console.error('Old image delete failed:', err);
        }
      }
      updateData.image = `/uploads/listings/${req.file.filename}`;
    }

    const updatedListing = await Listing.findByIdAndUpdate(
      id,
      { $set: updateData },
      { returnDocument: 'after', runValidators: true }
    ).populate('category culturalTags');

    res.status(200).json({
      message: 'Listing updated and submitted for re-review',
      updatedListing,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getPublicListings = async (req, res) => {
  try {
    const { filter } = req.query;
    let query = { status: 'approved' };

    const now = new Date();
    if (filter === 'Today') {
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: startOfDay };
    } else if (filter === 'This week') {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - 7);
      query.createdAt = { $gte: startOfWeek };
    }

    let listings = await Listing.find(query)
      .populate('creatorId', 'username')
      .populate('category', 'title')
      .populate({
        path: 'culturalTags',
        select: 'title image',
      })
      .sort({ createdAt: -1 })
      .lean();

    const currentUserId = req.user ? req.user._id.toString() : null;

    const formattedListings = listings.map((item) => {
      const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];

      return {
        ...item,
        culturalTags: (item.culturalTags || []).filter((t) => t && typeof t === 'object' && t._id),
        isFavorited: currentUserId
          ? safeFavorites.some((favId) => favId.toString() === currentUserId)
          : false,
        favoritesCount: safeFavorites.length,
      };
    });

    res.status(200).json(formattedListings);
  } catch (error) {
    console.error('Get Public Listings Error:', error);
    res.status(500).json({ message: 'Internal Server Error. Checking data integrity.' });
  }
};

export const getMyListings = async (req, res) => {
  try {
    const currentUserId = req.user._id.toString();

    const listings = await Listing.find({ creatorId: req.user._id })
      .populate('category', 'title')
      .populate({
        path: 'culturalTags',
        select: 'title image',
      })
      .sort({ createdAt: -1 })
      .lean();

    const formattedListings = listings.map((item) => {
      const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];

      return {
        ...item,
        culturalTags: (item.culturalTags || []).filter((t) => t && typeof t === 'object' && t._id),
        isFavorited: safeFavorites.some((favId) => favId?.toString() === currentUserId),
        favoritesCount: safeFavorites.length,
      };
    });

    res.status(200).json(formattedListings);
  } catch (error) {
    console.error('Get My Listings Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const toggleFavorite = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const listing = await Listing.findById(id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    const isFavorited = listing.favorites.includes(userId);

    const updatedListing = await Listing.findByIdAndUpdate(
      id,
      isFavorited ? { $pull: { favorites: userId } } : { $addToSet: { favorites: userId } },
      { new: true }
    );

    res.status(200).json({
      message: isFavorited ? 'Removed from favorites' : 'Added to favorites',
      isFavorited: !isFavorited,
      favoritesCount: updatedListing.favorites.length,
    });
  } catch (error) {
    console.error('Favorite Toggle Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const listing = await Listing.findById(id);

    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    if (listing.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const imagePath = path.join(process.cwd(), listing.image);
    if (fs.existsSync(imagePath)) {
      try {
        fs.unlinkSync(imagePath);
      } catch (err) {
        console.error('Image file delete error:', err);
      }
    }

    await Listing.findByIdAndDelete(id);
    res.status(200).json({ message: 'Listing deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
