import Listing from '../models/Listing.js';
import fs from 'fs';
import path from 'path';
import Category from '../models/Category.js';
import Tag from '../models/Tag.js';

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
      if (listing.image && !listing.image.startsWith('http')) {
        const oldImagePath = path.join(process.cwd(), listing.image);
        if (fs.existsSync(oldImagePath)) {
          try {
            fs.unlinkSync(oldImagePath);
          } catch (err) {
            console.error('Old local image delete failed:', err);
          }
        }
      }

      updateData.image = req.file.path;
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
    const { filter, search, category, region, creatorId, limit, page } = req.query;

    let query = { status: 'approved' };

    // Time filter logic
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

    // Category, Region, Creator filters
    if (creatorId) query.creatorId = creatorId;
    if (category && category !== 'All') {
      query.category = category;
    }
    if (region && region !== 'All') query.region = region;

    // Search filter logic (Title, Country, Tradition) with case-insensitive regex
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { country: { $regex: search, $options: 'i' } },
        { tradition: { $regex: search, $options: 'i' } },
      ];
    }

    // Pagination logic
    const resPerPage = parseInt(limit) || 20;
    const currentPage = parseInt(page) || 1;
    const skip = resPerPage * (currentPage - 1);

    // Data fetching login
    // Searching, filtering, and pagination are done in the query, but sorting is done in-memory after fetching to ensure promoted listings are always on top regardless of other filters.
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

    // Total count for pagination
    const totalListings = await Listing.countDocuments(query);

    // Favorites logic with safety checks
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

    // Sending response with total count for pagination
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
    const listing = await Listing.findById(req.params.id);

    // Cost per click, defaulting to 0.1 if not set
    const cost = listing.promotion.costPerClick || 0.1;

    if (
      listing &&
      listing.promotion.type === 'ppc' &&
      listing.promotion.ppcBalance >= cost
    ) {
      listing.promotion.ppcBalance = Number((listing.promotion.ppcBalance - cost).toFixed(2));

      // if balance is insufficient after deduction, demote the listing
      if (listing.promotion.ppcBalance < cost) {
        listing.isPromoted = false;
        listing.promotion.level = 0;
        listing.promotion.type = 'none';
      }

      await listing.save();
    }

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
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

    const listing = await Listing.findByIdAndUpdate(id, { $inc: { views: 1 } }, { new: true })
      .populate('creatorId', 'username firstName lastName profile email')
      .populate('category', 'title')
      .populate('culturalTags', 'title image');

    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    res.status(200).json(listing);
  } catch (error) {
    console.error('Error fetching listing details:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getMyListings = async (req, res) => {
  try {
    // ১. চেক করুন ইউজার লগইন করা কি না (Auth Middleware check)
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const currentUserId = req.user._id.toString();

    // ২. লিস্টিং ফেচ করা
    const listings = await Listing.find({ creatorId: currentUserId })
      .populate('category', 'title')
      .populate('culturalTags', 'title image') // সিম্পল পপুলেশন
      .sort({ createdAt: -1 })
      .lean();

    // ৩. ডাটা ফরম্যাটিং (সেফ চেক সহ)
    const formattedListings = listings.map((item) => {
      // নিশ্চিত করুন favorites একটি অ্যারে
      const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];

      return {
        ...item,
        // ক্যাটাগরি না থাকলে 'Uncategorized' দেখাবে
        categoryName: item.category?.title || 'Uncategorized',
        // ট্যাগ ফিল্টারিং সেফ রাখা
        culturalTags: (item.culturalTags || []).filter((t) => t && t._id),
        // বর্তমান ইউজার ফেভারিট করেছে কি না
        isFavorited: safeFavorites.some((favId) => favId?.toString() === currentUserId),
        favoritesCount: safeFavorites.length,
      };
    });

    res.status(200).json(formattedListings);
  } catch (error) {
    // কনসোলে এররটি দেখুন আসলে কোথায় ভুল হচ্ছে
    console.error('SERVER ERROR IN GET_MY_LISTINGS:', error);
    res.status(500).json({
      message: 'Failed to fetch your listings',
      error: error.message, // এটি ফ্রন্টএন্ডে এরর ডিবাগ করতে সাহায্য করবে
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
