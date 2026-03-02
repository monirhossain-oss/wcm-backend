import Analytics from '../models/Analytics.js';

export const trackActivity = async (listingId, creatorId, type = 'view') => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); 

    const update = type === 'view' ? { $inc: { views: 1 } } : { $inc: { clicks: 1 } };

    await Analytics.findOneAndUpdate({ listingId, creatorId, date: today }, update, {
      upsert: true,
      new: true,
    });
  } catch (err) {
    console.error('Analytics Error:', err);
  }
};
