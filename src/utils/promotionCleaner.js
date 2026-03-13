import cron from 'node-cron';
import Listing from '../models/Listing.js';

const startPromotionCleaner = () => {
  // প্রতিদিন রাত ১২টা (00:00) এ একবার রান করবে
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('Running Daily Promotion Cleaner Job...');
      const now = new Date();

      // ১. মেয়াদ উত্তীর্ণ বুস্ট অফ করা
      await Listing.updateMany(
        { 'promotion.boost.isActive': true, 'promotion.boost.expiresAt': { $lt: now } },
        { $set: { 'promotion.boost.isActive': false } }
      );

      // ২. ব্যালেন্স শেষ অথবা CPC ব্যালেন্সের চেয়ে বেশি হলে PPC অফ করা
      const listingsToDisablePpc = await Listing.find({
        'promotion.ppc.isActive': true,
        $or: [
          { 'promotion.ppc.ppcBalance': { $lte: 0 } },
          { $expr: { $lt: ['$promotion.ppc.ppcBalance', '$promotion.ppc.costPerClick'] } },
        ],
      });

      if (listingsToDisablePpc.length > 0) {
        const ids = listingsToDisablePpc.map((l) => l._id);
        await Listing.updateMany(
          { _id: { $in: ids } },
          {
            $set: {
              'promotion.ppc.isActive': false,
              'promotion.ppc.ppcBalance': 0,
              'promotion.ppc.amountPaid': 0,
              'promotion.ppc.totalClicks': 0,
              'promotion.ppc.executedClicks': 0,
            },
          }
        );
      }

      // ৩. যাদের বুস্ট এবং পিপিছি দুটোই অফ, তাদের isPromoted এবং level রিসেট করা
      await Listing.updateMany(
        {
          isPromoted: true,
          'promotion.boost.isActive': false,
          'promotion.ppc.isActive': false,
        },
        { $set: { isPromoted: false, 'promotion.level': 0 } }
      );

      // ৪. একটিভ লিস্টিংগুলোর লেভেল রি-ক্যালকুলেশন
      const activeListings = await Listing.find({
        $or: [{ 'promotion.boost.isActive': true }, { 'promotion.ppc.isActive': true }],
      });

      if (activeListings.length > 0) {
        const bulkOps = activeListings.map((listing) => {
          let level = 0;

          // বুস্ট স্কোর
          if (listing.promotion.boost.isActive) {
            level += (listing.promotion.boost.amountPaid / 7) * 2;
          }

          // পিপিছি স্কোর
          if (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) {
            level +=
              listing.promotion.ppc.costPerClick * 10 + listing.promotion.ppc.ppcBalance / 10;
          }

          return {
            updateOne: {
              filter: { _id: listing._id },
              update: {
                $set: {
                  'promotion.level': Math.floor(level),
                  isPromoted: true,
                },
              },
            },
          };
        });
        await Listing.bulkWrite(bulkOps);
      }

      console.log('Daily Promotion Cleaner Task Completed Successfully.');
    } catch (error) {
      console.error('Cron Cleaner Error:', error);
    }
  });
};

export default startPromotionCleaner;
