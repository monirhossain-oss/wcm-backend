import Listing from '../models/Listing.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import Analytics from '../models/Analytics.js';

export const getCreatorDashboardStats = async (req, res) => {
  try {
    const creatorId = req.user._id;

    const [user, listings, transactions] = await Promise.all([
      User.findById(creatorId).select('walletBalance'),
      Listing.find({ creatorId }),
      Transaction.find({ creator: creatorId, status: 'completed' }),
    ]);

    const totalSpent = transactions
      .reduce((acc, curr) => acc + (Number(curr.amountPaid) || 0), 0)
      .toFixed(2);

    const totalViews = listings.reduce((acc, curr) => acc + (curr.views || 0), 0);
    const totalPaidClicks = listings.reduce(
      (acc, curr) => acc + (curr.promotion?.ppc?.totalClicks || 0),
      0
    );
    const totalFavorites = listings.reduce((acc, curr) => acc + (curr.favorites?.length || 0), 0);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const analyticsData = await Analytics.find({
      creatorId,
      date: { $gte: sevenDaysAgo },
    });

    const chartData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);

      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });

      const dayRecord = analyticsData.find((a) => new Date(a.date).getTime() === d.getTime());

      chartData.push({
        name: dayName,
        views: dayRecord ? dayRecord.views : 0,
        clicks: dayRecord ? dayRecord.clicks : 0,
      });
    }

    const stats = {
      totalListings: listings.length,
      totalViews,
      totalPaidClicks,
      totalFavorites,
      activePromotions: listings.filter((l) => l.isPromoted).length,

      totalSpent,
      walletBalance: (Number(user?.walletBalance) || 0).toFixed(2),

      totalPpcBalance: listings
        .reduce((acc, curr) => acc + (curr.promotion?.ppc?.ppcBalance || 0), 0)
        .toFixed(2),

      statusCount: {
        approved: listings.filter((l) => l.status === 'approved').length,
        pending: listings.filter((l) => l.status === 'pending').length,
        rejected: listings.filter((l) => l.status === 'rejected').length,
      },

      chartData: chartData,
    };

    res.status(200).json(stats);
  } catch (error) {
    console.error('Dashboard Stats Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard stats',
      error: error.message,
    });
  }
};

export const getMyTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({ creator: req.user._id })
      .populate('listing', 'title image')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: transactions.length,
      transactions,
    });
  } catch (error) {
    console.error('Transaction Fetch Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
    });
  }
};
