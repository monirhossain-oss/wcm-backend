import cron from 'node-cron';
import Listing from '../models/Listing.js';

const startPromotionCleaner = () => {
  cron.schedule('0 0 * * *', async () => {
    console.log('--- Running Promotion Expiry Check ---');

    try {
      const now = new Date();

      const expiredBoosts = await Listing.updateMany(
        {
          'promotion.type': 'boost',
          'promotion.expiresAt': { $lt: now },
          isPromoted: true,
        },
        {
          $set: {
            isPromoted: false,
            'promotion.type': 'none',
            'promotion.level': 0,
          },
        }
      );

      const emptyPpc = await Listing.updateMany(
        {
          'promotion.type': 'ppc',
          'promotion.ppcBalance': { $lte: 0 },
          isPromoted: true,
        },
        {
          $set: {
            isPromoted: false,
            'promotion.type': 'none',
            'promotion.level': 0,
          },
        }
      );

      console.log(`✅ Expired boosts cleaned: ${expiredBoosts.modifiedCount}`);
      console.log(`✅ Empty PPC balances cleaned: ${emptyPpc.modifiedCount}`);
    } catch (error) {
      console.error('❌ Error in Promotion Cleaner Cron:', error);
    }
  });
};

export default startPromotionCleaner;
