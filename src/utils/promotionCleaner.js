import cron from 'node-cron';
import Listing from '../models/Listing.js';

const startPromotionCleaner = () => {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();

      await Listing.updateMany(
        {
          'promotion.boost.isActive': true,
          'promotion.boost.expiresAt': { $lt: now },
        },
        { $set: { 'promotion.boost.isActive': false } }
      );

      await Listing.updateMany(
        {
          'promotion.ppc.isActive': true,
          'promotion.ppc.ppcBalance': { $lte: 0 },
        },
        { $set: { 'promotion.ppc.isActive': false } }
      );

      const deactivatedResult = await Listing.updateMany(
        {
          isPromoted: true,
          'promotion.boost.isActive': false,
          'promotion.ppc.isActive': false,
        },
        {
          $set: {
            isPromoted: false,
            'promotion.level': 0,
          },
        }
      );

      const activePromotions = await Listing.find({ isPromoted: true });

      if (activePromotions.length > 0) {
        const bulkOps = activePromotions.map((listing) => {
          const boostAmt = listing.promotion.boost.isActive
            ? listing.promotion.boost.amountPaid || 0
            : 0;
          const ppcAmt = listing.promotion.ppc.isActive ? listing.promotion.ppc.amountPaid || 0 : 0;
          const viewsCount = listing.views || 0;
          const favCount = listing.favorites?.length || 0;

          const newLevel = Math.floor(
            boostAmt * 1.5 + ppcAmt * 1.2 + viewsCount * 0.1 + favCount * 2
          );

          return {
            updateOne: {
              filter: { _id: listing._id },
              update: { $set: { 'promotion.level': newLevel } },
            },
          };
        });

        if (bulkOps.length > 0) {
          await Listing.bulkWrite(bulkOps);
        }
      }

      if (deactivatedResult.modifiedCount > 0) {
        console.log(
          `[Cron] Sync: ${deactivatedResult.modifiedCount} listings returned to standard status.`
        );
      }
    } catch (error) {
      console.error('❌ Promotion Protocol Error:', error);
    }
  });
};

export default startPromotionCleaner;
