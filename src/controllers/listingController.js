import Listing from '../models/Listing.js';
import fs from 'fs';
import path from 'path';
import Category from '../models/Category.js';
import Tag from '../models/Tag.js';
import User from '../models/User.js';
import mongoose from 'mongoose';
import { calculateListingLevel } from '../utils/levelCalculator.js';
import Analytics from '../models/Analytics.js';

const clickCooldowns = new Map();
const viewCache = new Map();

export const getCategoriesAndTags = async (req, res) => {
  try {
    const categories = await Category.find().sort({ order: 1 });

    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;

    const tagsWithCount = await Tag.aggregate([
      { $sort: { title: 1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'listings',
          localField: '_id',
          foreignField: 'culturalTags',
          as: 'matchedListings',
        },
      },
      {
        $project: {
          _id: 1,
          title: 1,
          image: 1,
          listingCount: {
            $size: {
              $filter: {
                input: '$matchedListings',
                as: 'listing',
                cond: { $eq: ['$$listing.status', 'approved'] },
              },
            },
          },
        },
      },
    ]);

    const totalTags = await Tag.countDocuments();

    res.status(200).json({
      success: true,
      categories: categories || [],
      tags: tagsWithCount || [],
      pagination: {
        totalTags,
        currentPage: page,
        totalPages: Math.ceil(totalTags / limit),
        hasMore: page * limit < totalTags,
      },
    });
  } catch (error) {
    console.error('Meta Data Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching meta data',
      error: error.message,
    });
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

    const imageUrl = req.file.path;

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
    console.error('Create Error:', error);
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

    const updateData = { ...req.body };

    if (listing.status !== 'approved') {
      listing.status = 'pending';
      listing.rejectionReason = '';
    }

    if (updateData.externalUrls) {
      listing.externalUrls = Array.isArray(updateData.externalUrls)
        ? updateData.externalUrls
        : updateData.externalUrls
            .split(',')
            .map((url) => url.trim())
            .filter((url) => url !== '');
    }

    if (updateData.culturalTags) {
      listing.culturalTags = Array.isArray(updateData.culturalTags)
        ? updateData.culturalTags
        : updateData.culturalTags
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t !== '');
    }

    if (req.file) {
      if (listing.image && !listing.image.startsWith('http')) {
        const oldImagePath = path.join(process.cwd(), listing.image);
        if (fs.existsSync(oldImagePath)) {
          try {
            fs.unlinkSync(oldImagePath);
          } catch (err) {
            console.error('Old image delete error:', err);
          }
        }
      }
      listing.image = req.file.path;
    }

    const fieldsToUpdate = [
      'title',
      'description',
      'region',
      'country',
      'tradition',
      'websiteLink',
      'category',
    ];
    fieldsToUpdate.forEach((field) => {
      if (updateData[field] !== undefined) {
        listing[field] = updateData[field];
      }
    });

    await listing.save();

    const finalListing = await Listing.findById(id).populate('category culturalTags');

    res.status(200).json({
      message:
        listing.status === 'approved'
          ? 'Listing updated successfully'
          : 'Listing updated and submitted for re-review',
      updatedListing: finalListing,
    });
  } catch (error) {
    console.error('Update Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getPublicListings = async (req, res) => {
  try {
    const { filter, search, category, region, tradition, creatorId, limit, page } = req.query;

    let query = { status: 'approved' };

    if (category && category !== 'All' && category !== 'undefined') {
      if (mongoose.Types.ObjectId.isValid(category)) {
        query.category = category;
      } else {
        const foundCategory = await Category.findOne({
          title: { $regex: category, $options: 'i' },
        });
        if (foundCategory) {
          query.category = foundCategory._id;
        } else {
          query.category = new mongoose.Types.ObjectId();
        }
      }
    }

    if (region && region !== 'All') query.region = region;
    if (tradition && tradition !== 'All') {
      query.tradition = { $regex: tradition, $options: 'i' };
    }

    const now = new Date();
    if (filter === 'Today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: startOfDay };
    } else if (filter === 'This week') {
      const startOfWeek = new Date();
      startOfWeek.setDate(now.getDate() - 7);
      startOfWeek.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: startOfWeek };
    }

    if (creatorId) query.creatorId = creatorId;

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { country: { $regex: search, $options: 'i' } },
        { tradition: { $regex: search, $options: 'i' } },
      ];
    }

    const resPerPage = parseInt(limit) || 10;
    const currentPage = parseInt(page) || 1;
    const skip = resPerPage * (currentPage - 1);

    let listings = await Listing.find(query)
      .populate('creatorId', 'username profile')
      .populate('category', 'title')
      .populate('culturalTags', 'title image')
      .sort({
        isPromoted: -1,
        'promotion.level': -1,
        views: -1,
        createdAt: -1,
      })
      .limit(resPerPage)
      .skip(skip)
      .lean();

    const totalListings = await Listing.countDocuments(query);
    const currentUserId = req.user ? req.user._id.toString() : null;

    const formattedListings = listings.map((item) => {
      const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];
      return {
        ...item,
        isFavorited: currentUserId
          ? safeFavorites.some((favId) => favId.toString() === currentUserId)
          : false,
        favoritesCount: safeFavorites.length,
      };
    });

    res.status(200).json({
      success: true,
      total: totalListings,
      count: formattedListings.length,
      currentPage,
      listings: formattedListings,
    });
  } catch (error) {
    console.error('Public Listings Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      details: error.message,
    });
  }
};

export const handlePpcClick = async (req, res) => {
  try {
    const listingId = req.params.id;
    const userIP =
      req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
    const cacheKey = `${userIP}_${listingId}`;
    const now = Date.now();

    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    const lastClick = clickCooldowns.get(cacheKey);
    const isSpam = lastClick && now - lastClick < 60000;

    const cost = listing.promotion?.ppc?.costPerClick || 0.1;
    let wasCharged = false;

    if (
      !isSpam &&
      listing.isPromoted &&
      listing.promotion?.ppc?.isActive &&
      listing.promotion?.ppc?.ppcBalance >= cost
    ) {
      listing.promotion.ppc.ppcBalance = Number(
        (listing.promotion.ppc.ppcBalance - cost).toFixed(2)
      );
      listing.promotion.ppc.totalClicks = (listing.promotion.ppc.totalClicks || 0) + 1;

      if (listing.promotion.ppc.ppcBalance < cost) {
        listing.promotion.ppc.isActive = false;
        if (!listing.promotion?.boost?.isActive) {
          listing.isPromoted = false;
        }
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      await Analytics.findOneAndUpdate(
        {
          listingId: listing._id,
          creatorId: listing.creatorId,
          date: today,
        },
        { $inc: { clicks: 1 } },
        { upsert: true, new: true }
      );

      await listing.save();

      wasCharged = true;

      clickCooldowns.set(cacheKey, now);
      setTimeout(() => clickCooldowns.delete(cacheKey), 300000);
    }

    res.status(200).json({
      success: true,
      redirectUrl: listing.websiteLink || '/',
      charged: wasCharged,
      message: isSpam
        ? 'Spam protected (Not charged)'
        : wasCharged
          ? 'Valid PPC click'
          : 'Click recorded (Not charged)',
    });
  } catch (error) {
    console.error('PPC Click Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const getCreatorListingCount = async (req, res) => {
  try {
    const count = await Listing.countDocuments({
      creatorId: req.params.creatorId,
      status: 'approved',
    });
    res.status(200).json({ count });
  } catch (err) {
    res.status(500).json(0);
  }
};

export const getListingById = async (req, res) => {
  try {
    const { id } = req.params;
    const clientIp =
      req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
    const cacheKey = `${id}-${clientIp}`;

    const now = Date.now();
    const cooldown = 24 * 60 * 60 * 1000;

    let listing = await Listing.findById(id)
      .populate('creatorId', 'username firstName lastName profile email')
      .populate('category', 'title')
      .populate('culturalTags', 'title image');

    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const lastViewed = viewCache.get(cacheKey);

    if (!lastViewed || now - lastViewed > cooldown) {
      listing.views = (listing.views || 0) + 1;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      await Analytics.findOneAndUpdate(
        {
          listingId: listing._id,
          creatorId: listing.creatorId,
          date: today,
        },
        { $inc: { views: 1 } },
        { upsert: true, new: true }
      );

      await listing.save();

      viewCache.set(cacheKey, now);
    }

    res.status(200).json(listing);
  } catch (error) {
    console.error('Error fetching listing details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch listing details',
      error: error.message,
    });
  }
};

export const getMyListings = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const currentUserId = req.user._id.toString();

    const listings = await Listing.find({ creatorId: currentUserId })
      .populate('category', 'title')
      .populate('culturalTags', 'title image')
      .sort({ createdAt: -1 })
      .lean();

    const formattedListings = listings.map((item) => {
      const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];
      return {
        ...item,
        categoryName: item.category?.title || 'Uncategorized',
        culturalTags: (item.culturalTags || []).filter((t) => t && t._id),
        isFavorited: safeFavorites.some((favId) => favId?.toString() === currentUserId),
        favoritesCount: safeFavorites.length,
      };
    });

    res.status(200).json(formattedListings);
  } catch (error) {
    console.error('SERVER ERROR IN GET_MY_LISTINGS:', error);
    res.status(500).json({
      message: 'Failed to fetch your listings',
      error: error.message,
    });
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
      listing.favorites.pull(userId);
    } else {
      listing.favorites.addToSet(userId);
    }

    listing.promotion.level = calculateListingLevel(listing);

    await listing.save();

    res.status(200).json({
      message: isFavorited ? 'Removed from favorites' : 'Added to favorites',
      isFavorited: !isFavorited,
      favoritesCount: listing.favorites.length,
      newLevel: listing.promotion.level,
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

    if (listing.image && !listing.image.startsWith('http')) {
      const imagePath = path.join(process.cwd(), listing.image);
      if (fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
        } catch (err) {
          console.error('Image file delete error:', err);
        }
      }
    }

    await Listing.findByIdAndDelete(id);
    res.status(200).json({ message: 'Listing deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const cancelPromotion = async (req, res) => {
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const { id } = req.params;
    const { type } = req.body;

    const listing = await Listing.findById(id).session(dbSession);

    if (!listing || listing.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized or Listing not found' });
    }

    let refundAmount = 0;
    let updateData = {};

    if (type === 'ppc' && listing.promotion?.ppc?.isActive) {
      refundAmount = listing.promotion.ppc.ppcBalance || 0;
      updateData['promotion.ppc.ppcBalance'] = 0;
      updateData['promotion.ppc.isActive'] = false;
      updateData['promotion.ppc.amountPaid'] = 0;
    } else if (type === 'boost' && listing.promotion?.boost?.isActive) {
      updateData['promotion.boost.isActive'] = false;
      updateData['promotion.boost.amountPaid'] = 0;
      updateData['promotion.boost.expiresAt'] = null;
    }

    if (refundAmount > 0) {
      await User.findByIdAndUpdate(
        req.user._id,
        { $inc: { walletBalance: Number(refundAmount.toFixed(2)) } },
        { session: dbSession }
      );
    }

    const tempListing = { ...listing.toObject() };

    if (type === 'ppc') {
      tempListing.promotion.ppc.isActive = false;
      tempListing.promotion.ppc.ppcBalance = 0;
    } else {
      tempListing.promotion.boost.isActive = false;
      tempListing.promotion.boost.amountPaid = 0;
    }

    const newLevel = calculateListingLevel(tempListing);
    updateData['promotion.level'] = newLevel;

    const isPpcStillActive = type === 'ppc' ? false : listing.promotion.ppc.isActive;
    const isBoostStillActive = type === 'boost' ? false : listing.promotion.boost.isActive;

    if (!isPpcStillActive && !isBoostStillActive) {
      updateData.isPromoted = false;
    }

    await Listing.findByIdAndUpdate(id, { $set: updateData }, { session: dbSession });

    await dbSession.commitTransaction();
    dbSession.endSession();

    res.status(200).json({
      success: true,
      message: `${type.toUpperCase()} cancelled. €${refundAmount.toFixed(2)} refunded to wallet.`,
      refundAmount,
    });
  } catch (error) {
    await dbSession.abortTransaction();
    dbSession.endSession();
    console.error('Promotion Cancel Error:', error);
    res.status(500).json({ message: error.message });
  }
};
