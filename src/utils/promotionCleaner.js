import cron from 'node-cron';
import Listing from '../models/Listing.js';

const startPromotionCleaner = () => {
  cron.schedule('0 0 * * *', async () => {
    console.log('--- Initiating Global Promotion Protocol Clean-up ---');

    try {
      const now = new Date();

      const expiredBoosts = await Listing.updateMany(
        {
          'promotion.boost.isActive': true,
          'promotion.boost.expiresAt': { $lt: now },
        },
        {
          $set: { 'promotion.boost.isActive': false },
        }
      );

      const emptyPpc = await Listing.updateMany(
        {
          'promotion.ppc.isActive': true,
          'promotion.ppc.ppcBalance': { $lte: 0 },
        },
        {
          $set: { 'promotion.ppc.isActive': false },
        }
      );

      const updatedListings = await Listing.find({
        $or: [
          { 'promotion.boost.isActive': false, 'promotion.ppc.isActive': false, isPromoted: true },
          { 'promotion.boost.expiresAt': { $lt: now }, isPromoted: true },
        ],
      });

      for (let listing of updatedListings) {
        await listing.save(); 
      }

      console.log(`✅ Deactivated Expired Boosts: ${expiredBoosts.modifiedCount}`);
      console.log(`✅ Deactivated Empty PPC: ${emptyPpc.modifiedCount}`);
      console.log(`✅ Synced isPromoted status for: ${updatedListings.length} assets`);
    } catch (error) {
      console.error('❌ Promotion Protocol Error:', error);
    }
  });
};

export default startPromotionCleaner;
