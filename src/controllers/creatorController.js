import Listing from '../models/Listing.js';
import Transaction from '../models/Transaction.js';

export const getCreatorDashboardStats = async (req, res) => {
  try {
    const creatorId = req.user._id;

    const listings = await Listing.find({ creatorId });

    // API response structure:
    const stats = {
      totalListings: listings.length,
      totalViews: listings.reduce((acc, curr) => acc + (curr.views || 0), 0),
      totalFavorites: listings.reduce((acc, curr) => acc + (curr.favorites?.length || 0), 0),
      activePromotions: listings.filter((l) => l.isPromoted).length,

      // Total PPC balance across all promoted listings
      totalPpcBalance: listings
        .reduce((acc, curr) => acc + (curr.promotion?.ppcBalance || 0), 0)
        .toFixed(2),

      // Listings count by status
      statusCount: {
        approved: listings.filter((l) => l.status === 'approved').length,
        pending: listings.filter((l) => l.status === 'pending').length,
        rejected: listings.filter((l) => l.status === 'rejected').length,
      },
    };

    res.status(200).json(stats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getMyTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({ creator: req.user._id })
      .populate('listing', 'title image')
      .sort({ createdAt: -1 });

    res.status(200).json(transactions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
