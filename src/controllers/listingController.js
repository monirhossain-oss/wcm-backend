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
    const { title, description, externalUrl, region, country, tradition, category, culturalTags } =
      req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'Please upload an image' });
    }

    const imageUrl = `/uploads/listings/${req.file.filename}`;

    let tagIds = [];
    if (culturalTags) {
      if (Array.isArray(culturalTags)) {
        tagIds = culturalTags;
      } else if (typeof culturalTags === 'string') {
        tagIds = culturalTags
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id !== '');
      }
    }

    const newListing = await Listing.create({
      creatorId: req.user._id || req.user.id,
      title,
      description,
      externalUrl,
      region,
      country,
      tradition,
      category,
      culturalTags: tagIds,
      image: imageUrl,
    });

    res.status(201).json({
      message: 'Listing created successfully',
      newListing,
    });
  } catch (error) {
    console.error('Create Listing Error:', error);

    if (req.file) {
      const fs = await import('fs');
      const path = await import('path');
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

    if (updateData.culturalTags && typeof updateData.culturalTags === 'string') {
      updateData.culturalTags = updateData.culturalTags.split(',');
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
      { new: true, runValidators: true }
    ).populate('category culturalTags');

    res.status(200).json({ message: 'Listing updated successfully', updatedListing });
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
      const startOfDay = new Date(now.setHours(0, 0, 0, 0));
      query.createdAt = { $gte: startOfDay };
    } else if (filter === 'This week') {
      const startOfWeek = new Date(now.setDate(now.getDate() - 7));
      query.createdAt = { $gte: startOfWeek };
    }

    const listings = await Listing.find(query)
      .populate('creatorId', 'username')
      .populate('category', 'title')
      .populate('culturalTags', 'title image')
      .sort({ createdAt: -1 });

    res.status(200).json(listings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getMyListings = async (req, res) => {
  try {
    const listings = await Listing.find({ creatorId: req.user._id })
      .populate('category', 'title')
      .populate('culturalTags', 'title image')
      .sort({ createdAt: -1 });
    res.status(200).json(listings);
  } catch (error) {
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

    if (isFavorited) {
      listing.favorites = listing.favorites.filter(
        (favId) => favId.toString() !== userId.toString()
      );
    } else {
      listing.favorites.push(userId);
    }

    await listing.save();
    res.status(200).json({
      message: isFavorited ? 'Removed from favorites' : 'Added to favorites',
      favoritesCount: listing.favorites.length,
      isFavorited: !isFavorited,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
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
