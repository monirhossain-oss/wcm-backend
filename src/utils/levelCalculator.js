export const calculateListingLevel = (listing) => {
  if (!listing) return 0;
  const ppcBudget = listing.promotion?.ppc?.ppcBalance || 0;
  const boostBudget = listing.promotion?.boost?.isActive
    ? listing.promotion.boost.amountPaid || 0
    : 0;
  const budgetScore = (ppcBudget + boostBudget) * 2;
  const viewScore = (listing.views || 0) * 0.5;
  const favoriteScore = (listing.favorites?.length || 0) * 5;
  const comboBonus =
    listing.promotion?.ppc?.isActive && listing.promotion?.boost?.isActive ? 50 : 0;
  const totalScore = budgetScore + viewScore + favoriteScore + comboBonus;
  return Math.floor(totalScore / 10) || 0;
};