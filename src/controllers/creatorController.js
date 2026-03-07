import Listing from '../models/Listing.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import Analytics from '../models/Analytics.js';

// export const getCreatorDashboardStats = async (req, res) => {
//   try {
//     const creatorId = req.user._id;
//     const now = new Date();

//     // Start of current month for "Total Spend" calculation
//     const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

//     const [listings, transactions] = await Promise.all([
//       Listing.find({ creatorId }),
//       Transaction.find({
//         creator: creatorId,
//         status: 'completed',
//         createdAt: { $gte: startOfMonth }, // For monthly spend calculation
//       }),
//     ]);

//     // 1. Total Views (Lifetime from all listings)
//     const totalViews = listings.reduce((acc, curr) => acc + (curr.views || 0), 0);

//     // 2. Total Monthly Spend (Boost & PPC in EUR)
//     const totalMonthlySpend = transactions
//       .reduce((acc, curr) => acc + (Number(curr.amountInEUR) || 0), 0)
//       .toFixed(2);

//     // 3. Active Boosts (Count listings where boost is active and not expired)
//     const activeBoostsCount = listings.filter(
//       (l) => l.promotion?.boost?.isActive && new Date(l.promotion.boost.expiresAt) > now
//     ).length;

//     // 4. Total Clicks (Total executed clicks from PPC)
//     const totalClicks = listings.reduce(
//       (acc, curr) => acc + (curr.promotion?.ppc?.executedClicks || 0),
//       0
//     );

//     // --- Graph Data Logic (Fixed 7-day synchronization) ---
//     const sevenDaysAgo = new Date();
//     sevenDaysAgo.setHours(0, 0, 0, 0);
//     sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

//     const analyticsData = await Analytics.find({
//       creatorId,
//       date: { $gte: sevenDaysAgo },
//     }).lean();

//     const chartData = [];
//     for (let i = 0; i < 7; i++) {
//       const d = new Date(sevenDaysAgo);
//       d.setDate(d.getDate() + i);
//       const dateString = d.toISOString().split('T')[0];
//       const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });

//       // Aggregate data if multiple records exist for the same day (safety check)
//       const dayRecords = analyticsData.filter(
//         (a) => new Date(a.date).toISOString().split('T')[0] === dateString
//       );

//       const dayViews = dayRecords.reduce((sum, rec) => sum + (rec.views || 0), 0);
//       const dayClicks = dayRecords.reduce((sum, rec) => sum + (rec.clicks || 0), 0);

//       chartData.push({
//         name: dayName,
//         views: dayViews,
//         clicks: dayClicks,
//       });
//     }

//     res.status(200).json({
//       success: true,
//       stats: {
//         totalViews,
//         totalMonthlySpend,
//         activeBoostsCount,
//         totalClicks,
//       },
//       chartData,
//     });
//   } catch (error) {
//     console.error('Dashboard Stats Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch creator dashboard statistics',
//     });
//   }
// };

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

    // 1. Time Range Setup
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setHours(0, 0, 0, 0);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [listings, transactions, allAnalytics, userWallet] = await Promise.all([
      Listing.find({ creatorId }),
      Transaction.find({
        creator: creatorId,
        status: 'completed',
        createdAt: { $gte: startOfMonth },
      }),
      Analytics.find({ creatorId }).lean(),
      User.findById(creatorId).select('walletBalance'),
    ]);

    // 2. Lifetime Totals from Analytics
    const lifetimeViews = allAnalytics.reduce((acc, curr) => acc + (curr.views || 0), 0);
    const lifetimeClicks = allAnalytics.reduce((acc, curr) => acc + (curr.clicks || 0), 0);

    // 3. Graph Synchronization (Last 7 Days)
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

    // 4. Monthly Spend Calculation
    const totalMonthlySpend = transactions.reduce(
      (acc, curr) => acc + (Number(curr.amountPaid) || 0),
      0
    );

    // ✅ 5. Filter Active Promotions (Boost & PPC)
    const activeBoostsCount = listings.filter(
      (l) => l.promotion?.boost?.isActive && new Date(l.promotion.boost.expiresAt) > now
    ).length;

    const activePpcCount = listings.filter(
      (l) => l.promotion?.ppc?.isActive && l.promotion.ppc.ppcBalance > 0
    ).length;

    // Optional: Count listings that have EITHER Boost or PPC active
    const totalActivePromoted = listings.filter(
      (l) =>
        (l.promotion?.boost?.isActive && new Date(l.promotion.boost.expiresAt) > now) ||
        (l.promotion?.ppc?.isActive && l.promotion.ppc.ppcBalance > 0)
    ).length;

    const statusCount = {
      approved: listings.filter((l) => l.status === 'approved').length,
      pending: listings.filter((l) => l.status === 'pending').length,
      rejected: listings.filter((l) => l.status === 'rejected').length,
    };

    res.status(200).json({
      success: true,
      stats: {
        totalViews: lifetimeViews,
        totalMonthlySpend: totalMonthlySpend.toFixed(2),
        activeBoostsCount, // Only Viral Boosts
        activePpcCount, // Only PPC campaigns
        totalActivePromoted, // Any active promotion
        totalClicks: lifetimeClicks,
        totalPpcBalance: userWallet?.walletBalance?.toFixed(2) || '0.00',
        totalListings: listings.length,
        statusCount,
      },
      chartData,
    });
  } catch (error) {
    console.error('Stats Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
