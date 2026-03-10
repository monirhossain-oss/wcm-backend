import Listing from '../models/Listing.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import Analytics from '../models/Analytics.js';

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

export const getPromotionAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const listing = await Listing.findOne({ _id: id, creatorId: userId })
      .select('title promotion views isPromoted image')
      .lean();

    if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });

    const ppc = listing.promotion?.ppc || {};
    const boost = listing.promotion?.boost || {};
    const now = new Date();

    // --- PPC Calculation ---
    const totalPurchased = Number(ppc.totalClicks) || 0;
    const executed = Number(ppc.executedClicks) || 0;
    const remaining = Math.max(0, totalPurchased - executed);
    const consumptionRate =
      totalPurchased > 0 ? Number(((executed / totalPurchased) * 100).toFixed(1)) : 0;

    // --- Boost Calculation (Real-time Focus) ---
    let daysRemaining = 0;
    let hoursRemaining = 0;
    let isExpiringSoon = false;

    if (boost.isActive && boost.expiresAt) {
      const expiry = new Date(boost.expiresAt);
      const diffMs = expiry - now;

      if (diffMs > 0) {
        daysRemaining = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        hoursRemaining = Math.floor(diffMs / (1000 * 60 * 60));
        // যদি ২৪ ঘণ্টার কম থাকে
        if (hoursRemaining < 24) isExpiringSoon = true;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        title: listing.title,
        image: listing.image,
        isPromoted: !!listing.isPromoted,
        level: listing.promotion?.level || 0,
        views: listing.views || 0,
        ppc: {
          isActive: !!(ppc.isActive && ppc.ppcBalance > 0),
          balance: Number(ppc.ppcBalance || 0).toFixed(2),
          costPerClick: Number(ppc.costPerClick || 0.1).toFixed(2),
          totalPurchased,
          clicksUsed: executed,
          clicksRemaining: remaining,
          consumptionRate: Math.min(100, consumptionRate),
        },
        boost: {
          isActive: !!(boost.isActive && hoursRemaining > 0),
          expiresAt: boost.expiresAt,
          daysRemaining,
          hoursRemaining,
          isExpiringSoon,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getCreatorDashboardStats = async (req, res) => {
  try {
    const creatorId = req.user._id;
    const now = new Date();

    // ১. ডাটাবেস থেকে ইউজার এবং ক্যাশ চেক
    const user = await User.findById(creatorId).select('dashboardStats walletBalance');

    const lastUpdate = user?.dashboardStats?.lastUpdated
      ? new Date(user.dashboardStats.lastUpdated)
      : null;
    const isCacheExpired = !lastUpdate || now - lastUpdate > 24 * 60 * 60 * 1000;

    // ২. ক্যাশ ভ্যালিড থাকলে রিটার্ন
    if (!isCacheExpired && user?.dashboardStats?.data) {
      return res.status(200).json({
        success: true,
        stats: user.dashboardStats.data.stats,
        chartData: user.dashboardStats.data.chartData,
        isCached: true,
      });
    }

    // ৩. নতুন ক্যালকুলেশন শুরু
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setHours(0, 0, 0, 0);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [listings, transactions, allAnalytics] = await Promise.all([
      Listing.find({ creatorId }),
      Transaction.find({
        creator: creatorId,
        status: 'completed',
        createdAt: { $gte: startOfMonth },
      }),
      Analytics.find({ creatorId }).lean(),
    ]);

    // অ্যানালিটিক্স ক্যালকুলেশন
    const lifetimeViews = allAnalytics.reduce((acc, curr) => acc + (curr.views || 0), 0);
    const lifetimeClicks = allAnalytics.reduce((acc, curr) => acc + (curr.clicks || 0), 0);

    // গ্রাফ ডাটা (৭ দিন)
    const chartData = [];
    for (let i = 0; i < 7; i++) {
      const targetDate = new Date(sevenDaysAgo);
      targetDate.setDate(targetDate.getDate() + i);
      const dateStr = targetDate.toISOString().split('T')[0];
      const dayData = allAnalytics.filter(
        (a) => new Date(a.date).toISOString().split('T')[0] === dateStr
      );
      chartData.push({
        name: targetDate.toLocaleDateString('en-US', { weekday: 'short' }),
        views: dayData.reduce((sum, d) => sum + (d.views || 0), 0),
        clicks: dayData.reduce((sum, d) => sum + (d.clicks || 0), 0),
      });
    }

    const totalMonthlySpend = transactions.reduce(
      (acc, curr) => acc + (Number(curr.amountPaid) || 0),
      0
    );

    // ফিল্টারিং লজিক
    const stats = {
      totalViews: lifetimeViews,
      totalMonthlySpend: totalMonthlySpend.toFixed(2),
      activeBoostsCount: listings.filter(
        (l) => l.promotion?.boost?.isActive && new Date(l.promotion.boost.expiresAt) > now
      ).length,
      activePpcCount: listings.filter(
        (l) => l.promotion?.ppc?.isActive && l.promotion.ppc.ppcBalance > 0
      ).length,
      totalActivePromoted: listings.filter(
        (l) =>
          (l.promotion?.boost?.isActive && new Date(l.promotion.boost.expiresAt) > now) ||
          (l.promotion?.ppc?.isActive && l.promotion.ppc.ppcBalance > 0)
      ).length,
      totalClicks: lifetimeClicks,
      totalPpcBalance: (user?.walletBalance || 0).toFixed(2),
      totalListings: listings.length,
      statusCount: {
        approved: listings.filter((l) => l.status === 'approved').length,
        pending: listings.filter((l) => l.status === 'pending').length,
        rejected: listings.filter((l) => l.status === 'rejected').length,
      },
    };

    // ৪. ক্যাশ আপডেট
    await User.findByIdAndUpdate(creatorId, {
      $set: {
        'dashboardStats.lastUpdated': now,
        'dashboardStats.data': { stats, chartData },
      },
    });

    res.status(200).json({
      success: true,
      stats,
      chartData,
      isCached: false,
    });
  } catch (error) {
    console.error('Stats Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// export const getCreatorDashboardStats = async (req, res) => {
//   try {
//     const creatorId = req.user._id;
//     const now = new Date();

//     // 1. Time Range Setup
//     const sevenDaysAgo = new Date();
//     sevenDaysAgo.setHours(0, 0, 0, 0);
//     sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

//     const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

//     const [listings, transactions, allAnalytics, userWallet] = await Promise.all([
//       Listing.find({ creatorId }),
//       Transaction.find({
//         creator: creatorId,
//         status: 'completed',
//         createdAt: { $gte: startOfMonth },
//       }),
//       Analytics.find({ creatorId }).lean(),
//       User.findById(creatorId).select('walletBalance'),
//     ]);

//     // 2. Lifetime Totals from Analytics
//     const lifetimeViews = allAnalytics.reduce((acc, curr) => acc + (curr.views || 0), 0);
//     const lifetimeClicks = allAnalytics.reduce((acc, curr) => acc + (curr.clicks || 0), 0);

//     // 3. Graph Synchronization (Last 7 Days)
//     const chartData = [];
//     for (let i = 0; i < 7; i++) {
//       const targetDate = new Date(sevenDaysAgo);
//       targetDate.setDate(targetDate.getDate() + i);
//       const dateStr = targetDate.toISOString().split('T')[0];

//       const dayData = allAnalytics.filter(
//         (a) => new Date(a.date).toISOString().split('T')[0] === dateStr
//       );

//       chartData.push({
//         name: targetDate.toLocaleDateString('en-US', { weekday: 'short' }),
//         views: dayData.reduce((sum, d) => sum + (d.views || 0), 0),
//         clicks: dayData.reduce((sum, d) => sum + (d.clicks || 0), 0),
//       });
//     }

//     // 4. Monthly Spend Calculation
//     const totalMonthlySpend = transactions.reduce(
//       (acc, curr) => acc + (Number(curr.amountPaid) || 0),
//       0
//     );

//     // ✅ 5. Filter Active Promotions (Boost & PPC)
//     const activeBoostsCount = listings.filter(
//       (l) => l.promotion?.boost?.isActive && new Date(l.promotion.boost.expiresAt) > now
//     ).length;

//     const activePpcCount = listings.filter(
//       (l) => l.promotion?.ppc?.isActive && l.promotion.ppc.ppcBalance > 0
//     ).length;

//     // Optional: Count listings that have EITHER Boost or PPC active
//     const totalActivePromoted = listings.filter(
//       (l) =>
//         (l.promotion?.boost?.isActive && new Date(l.promotion.boost.expiresAt) > now) ||
//         (l.promotion?.ppc?.isActive && l.promotion.ppc.ppcBalance > 0)
//     ).length;

//     const statusCount = {
//       approved: listings.filter((l) => l.status === 'approved').length,
//       pending: listings.filter((l) => l.status === 'pending').length,
//       rejected: listings.filter((l) => l.status === 'rejected').length,
//     };

//     res.status(200).json({
//       success: true,
//       stats: {
//         totalViews: lifetimeViews,
//         totalMonthlySpend: totalMonthlySpend.toFixed(2),
//         activeBoostsCount, // Only Viral Boosts
//         activePpcCount, // Only PPC campaigns
//         totalActivePromoted, // Any active promotion
//         totalClicks: lifetimeClicks,
//         totalPpcBalance: userWallet?.walletBalance?.toFixed(2) || '0.00',
//         totalListings: listings.length,
//         statusCount,
//       },
//       chartData,
//     });
//   } catch (error) {
//     console.error('Stats Error:', error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

