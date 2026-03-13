// utils/promotionHelper.js

export const resetBoost = (listing) => {
  listing.promotion.boost.isActive = false;
  listing.promotion.boost.expiresAt = null;
  listing.promotion.boost.amountPaid = 0;
};

export const resetPPC = (listing) => {
  listing.promotion.ppc.isActive = false;
  listing.promotion.ppc.ppcBalance = 0;
  listing.promotion.ppc.amountPaid = 0;
  listing.promotion.ppc.totalClicks = 0;
  listing.promotion.ppc.executedClicks = 0;
};

export const checkAndCleanupExpiry = (listing) => {
  const now = new Date();

  // ১. বুস্ট এক্সপায়ার চেক
  if (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt <= now) {
    resetBoost(listing);
  }

  // ২. পিপিছি ব্যালেন্স চেক
  if (
    listing.promotion.ppc.isActive &&
    listing.promotion.ppc.ppcBalance < listing.promotion.ppc.costPerClick
  ) {
    resetPPC(listing);
  }
};

export const applyPromotionLogic = (listing) => {
  // আগে এক্সপায়ারড গুলো পরিষ্কার করে নিবে যাতে লেভেল ভুল না আসে
  checkAndCleanupExpiry(listing);

  let boostScore = 0;
  let ppcScore = 0;
  const now = new Date();

  // বুস্ট স্কোর (অ্যামাউন্ট এবং রিমেইনিং ডেইজ ভিত্তিক)
  if (listing.promotion.boost.isActive) {
    const amount = listing.promotion.boost.amountPaid || 0;
    const expiry = new Date(listing.promotion.boost.expiresAt);
    const daysDiff = Math.ceil(Math.abs(expiry - now) / (1000 * 60 * 60 * 24)) || 1;
    boostScore = (amount / daysDiff) * 10;
  }

  // পিপিছি স্কোর (সিপিসি এবং কারেন্ট ব্যালেন্স ভিত্তিক)
  if (listing.promotion.ppc.isActive) {
    const cpc = listing.promotion.ppc.costPerClick || 0.1;
    const balance = listing.promotion.ppc.ppcBalance || 0;
    ppcScore = cpc * 50 + balance * 0.05;
  }

  listing.promotion.level = Math.floor(boostScore + ppcScore);
  listing.isPromoted = listing.promotion.boost.isActive || listing.promotion.ppc.isActive;

  if (!listing.isPromoted) listing.promotion.level = 0;

  return listing;
};
